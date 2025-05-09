// src/services/api.js - Updated with improved token handling
import { useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth as useClerkAuth } from '@clerk/clerk-react';

// Create axios instance with proper configuration
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  // Add timeout to prevent hanging requests
  timeout: 60000, // 60 seconds timeout
  // Enable credentials for CORS
  withCredentials: true,
});

// Store the token and interceptor ID for non-hook contexts
let authToken = null;
let tokenExpiryTime = null;
let tokenIssuedAt = null;
let tokenLifespan = null;
let requestInterceptorId = null;
let responseInterceptorId = null;
let isRefreshing = false;
let refreshPromise = null;
let refreshCallbacks = [];
let lastActivityTimestamp = Date.now();
const TOKEN_REFRESH_BUFFER = 5 * 60 * 1000; // 5 minutes buffer for token refresh

// Update activity timestamp on user interaction
if (typeof window !== 'undefined') {
  const updateActivityTimestamp = () => {
    lastActivityTimestamp = Date.now();
  };
  
  // Add event listeners for user activity
  ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(event => {
    window.addEventListener(event, updateActivityTimestamp, { passive: true });
  });
}

// Function to decode a JWT token without verifying signature
const decodeToken = (token) => {
  if (!token) return null;
  
  try {
    // Extract the payload part of the JWT
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    const payload = parts[1];
    // Decode base64url-encoded payload
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    
    // Calculate padding
    const pad = base64.length % 4;
    const paddedBase64 = pad ? base64 + '='.repeat(4 - pad) : base64;
    
    // Decode
    try {
      const jsonPayload = atob(paddedBase64);
      return JSON.parse(jsonPayload);
    } catch (decodeError) {
      // Fallback to manual decode if atob fails
      const rawData = window.decodeURIComponent(
        window
          .atob(paddedBase64)
          .split('')
          .map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join('')
      );
      return JSON.parse(rawData);
    }
  } catch (error) {
    console.error('Error decoding token:', error);
    return null;
  }
};

// Function to calculate time remaining until token expiration
const getTokenTimeRemaining = (token) => {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return 0;
  
  const now = Math.floor(Date.now() / 1000);
  return decoded.exp - now;
};

// Function to check if token needs refresh (expiring soon or already expired)
const shouldRefreshToken = (token) => {
  if (!token) return true;
  
  const timeRemaining = getTokenTimeRemaining(token) * 1000; // Convert to ms
  // For 1-minute tokens, we need to refresh when only 15 seconds remain
  return timeRemaining < 15000; // 15 seconds
};

// Function to log token information
const logTokenInfo = (token, source = "unknown") => {
  if (!token) {
    console.error('No token provided to logTokenInfo');
    return null;
  }
  
  const decodedToken = decodeToken(token);
  if (!decodedToken) {
    console.error('Failed to decode token');
    return null;
  }
  
  const now = Math.floor(Date.now() / 1000);
  const exp = decodedToken.exp;
  const iat = decodedToken.iat;
  
  if (!exp || !iat) {
    console.error('Token missing expiration or issued-at claims');
    return null;
  }
  
  // Calculate token lifespan and remaining time
  const lifespan = exp - iat;
  const lifespanMinutes = Math.floor(lifespan / 60);
  const lifespanSeconds = lifespan % 60;
  
  const remaining = Math.max(0, exp - now);
  const remainingMinutes = Math.floor(remaining / 60);
  const remainingSeconds = remaining % 60;
  
  // Format dates for logging
  const issuedDate = new Date(iat * 1000).toISOString();
  const expiryDate = new Date(exp * 1000).toISOString();
  
  // Store token info
  tokenIssuedAt = iat;
  tokenExpiryTime = exp * 1000;
  tokenLifespan = lifespan;
  
  // Create log message
  const logMessage = `
🔐 TOKEN INFO (${source}):
  Issued at: ${issuedDate}
  Expires at: ${expiryDate}
  Total lifespan: ${lifespanMinutes} minutes ${lifespanSeconds} seconds (${lifespan} seconds)
  Remaining time: ${remainingMinutes}m ${remainingSeconds}s
  Subject: ${decodedToken.sub || 'N/A'}
  Issuer: ${decodedToken.iss || 'N/A'}
  Audience: ${decodedToken.aud || 'N/A'}
  `;
  
  // Log to console
  console.log(logMessage);
  
  // Store token history
  try {
    const tokenHistory = JSON.parse(localStorage.getItem('tokenHistory') || '[]');
    tokenHistory.push({
      timestamp: Date.now(),
      source,
      issuedAt: iat,
      expiresAt: exp,
      lifespan,
      remaining,
      sub: decodedToken.sub
    });
    
    // Keep only last 10 entries
    while (tokenHistory.length > 10) {
      tokenHistory.shift();
    }
    
    localStorage.setItem('tokenHistory', JSON.stringify(tokenHistory));
  } catch (e) {
    console.warn('Failed to store token history:', e);
  }
  
  return {
    issuedAt: iat,
    expiresAt: exp,
    lifespan,
    remaining
  };
};

// Enhanced Clerk Authentication Hook with Token Refreshing
export const useApiAuth = () => {
  const { getToken, isSignedIn } = useClerkAuth();
  const keepaliveIntervalRef = useRef(null);
  const tokenRefreshTimeoutRef = useRef(null);
  
  // Function to refresh the token
  const refreshToken = useCallback(async (force = false) => {
    // If already refreshing, return the existing promise
    if (isRefreshing && !force) {
      return refreshPromise;
    }
    
    // Rate limiting - don't refresh more than once per 30 seconds
    const now = Date.now();
    if (!window.__lastApiTokenRefresh) {
      window.__lastApiTokenRefresh = 0;
    }
    
    const timeSinceLastRefresh = now - window.__lastApiTokenRefresh;
    if (!force && timeSinceLastRefresh < 30000) { // 30 seconds
      console.log(`Skipping API token refresh - too soon (${Math.round(timeSinceLastRefresh/1000)}s since last refresh)`);
      return authToken; // Return existing token
    }
    
    try {
      isRefreshing = true;
      console.log('🔄 Refreshing authentication token...');
      
      // Store last refresh time
      window.__lastApiTokenRefresh = now;
      
      // Request a token with long expiration
      refreshPromise = getToken({ 
        skipCache: true, // Always get a fresh token when explicitly refreshing
        expiration: 60 * 60 // Request 1 hour token (may not be honored)
      }); 
      
      // Add timeout to token fetch
      const tokenPromise = Promise.race([
        refreshPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Token refresh timed out')), 8000)
        )
      ]);
      
      let token;
      try {
        token = await tokenPromise;
      } catch (tokenError) {
        console.warn('Token refresh error or timeout:', tokenError);
        
        // If we have an existing token, use it instead of failing
        if (authToken) {
          console.log('Using existing token despite refresh failure');
          return authToken;
        }
        throw tokenError;
      }
      
      if (token) {
        // Log token information
        const tokenInfo = logTokenInfo(token, "refresh");
        
        // Store token
        authToken = token;
        
        // Calculate expiry time with 5 second buffer
        if (tokenInfo && tokenInfo.remaining) {
          tokenExpiryTime = Date.now() + ((tokenInfo.remaining - 5) * 1000);
        } else {
          // Default to 45 seconds if we can't determine actual expiry
          tokenExpiryTime = Date.now() + 45000;
        }
        
        console.log(`Token refreshed, valid for ${Math.max(0, Math.floor((tokenExpiryTime - Date.now()) / 1000))} seconds`);
        
        // Process callbacks
        refreshCallbacks.forEach(callback => callback(token));
        refreshCallbacks = [];
        
        // Set up refresh before expiry
        scheduleTokenRefresh(token);
      } else {
        console.warn('No token returned from refresh attempt');
        
        // If we have an existing token, use it instead of failing
        if (authToken) {
          console.log('Using existing token due to empty refresh result');
          return authToken;
        }
      }
      
      return token;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      
      // If we have an existing token and this isn't a forced refresh,
      // return the existing token instead of failing
      if (authToken && !force) {
        console.log('Using existing token despite refresh error');
        return authToken;
      }
      
      throw error;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  }, [getToken]);
  
  const scheduleTokenRefresh = useCallback((token) => {
    // Clear any existing refresh timeout
    if (tokenRefreshTimeoutRef.current) {
      clearTimeout(tokenRefreshTimeoutRef.current);
      tokenRefreshTimeoutRef.current = null;
    }
    
    if (!token) return;
    
    // Calculate time remaining with 5 second buffer
    const timeRemaining = Math.max(0, getTokenTimeRemaining(token) - 5) * 1000;
    const refreshAt = Math.max(timeRemaining, 100); // Minimum 100ms
    
    console.log(`Scheduling token refresh in ${Math.floor(refreshAt / 1000)} seconds`);
    tokenRefreshTimeoutRef.current = setTimeout(() => {
      refreshToken(true).catch(err => console.error("Failed scheduled token refresh:", err));
    }, refreshAt);
  }, [refreshToken]);
  
  // Session keepalive implementation
  const setupKeepAlive = useCallback(() => {
    // Clear existing interval if any
    if (keepaliveIntervalRef.current) {
      clearInterval(keepaliveIntervalRef.current);
    }
    
    // Setup keepalive ping every 4 minutes during inactivity
    keepaliveIntervalRef.current = setInterval(() => {
      const inactiveTime = Date.now() - lastActivityTimestamp;
      const INACTIVITY_THRESHOLD = 3 * 60 * 1000; // 3 minutes
      
      // If user has been inactive for over threshold, send a keepalive
      if (inactiveTime > INACTIVITY_THRESHOLD) {
        console.log(`🔄 User inactive for ${Math.round(inactiveTime / 60000)} minutes, sending keepalive`);
        
        // Check if token needs refresh
        if (authToken && shouldRefreshToken(authToken)) {
          console.log('🔄 Token expiring soon, refreshing during inactivity period');
          refreshToken(true).catch(err => {
            console.error('Failed inactivity token refresh:', err);
          });
        } else {
          // Ping a lightweight endpoint to keep session alive
          api.get('/health', { timeout: 5000 })
            .then(() => console.log('✅ Keepalive ping successful'))
            .catch(err => console.warn('⚠️ Keepalive ping failed:', err));
        }
      }
    }, 4 * 60 * 1000); // Check every 4 minutes
    
    return () => {
      if (keepaliveIntervalRef.current) {
        clearInterval(keepaliveIntervalRef.current);
      }
    };
  }, [refreshToken]);
  
  // Function to get token diagnostics for debugging
  const getTokenDiagnostics = useCallback(async () => {
    try {
      // Get current token
      const token = authToken || await getToken({ expiration: 60 * 60 });
      if (!token) {
        return { error: 'No token available' };
      }
      
      // Decode and log token info
      const tokenInfo = logTokenInfo(token, "diagnostic");
      
      // Get token history from localStorage
      let history = [];
      try {
        history = JSON.parse(localStorage.getItem('tokenHistory') || '[]');
      } catch (e) {
        console.warn('Failed to parse token history:', e);
      }
      
      return {
        currentToken: {
          issuedAt: new Date(tokenInfo.issuedAt * 1000).toISOString(),
          expiresAt: new Date(tokenInfo.expiresAt * 1000).toISOString(),
          lifespanMinutes: Math.floor(tokenInfo.lifespan / 60),
          remainingMinutes: Math.floor(tokenInfo.remaining / 60)
        },
        history: history,
        tokenState: {
          isRefreshing,
          callbacksWaiting: refreshCallbacks.length,
          lastActivity: new Date(lastActivityTimestamp).toISOString(),
          inactiveFor: Math.floor((Date.now() - lastActivityTimestamp) / 1000) + ' seconds'
        }
      };
    } catch (error) {
      console.error('Error getting token diagnostics:', error);
      return { error: String(error) };
    }
  }, [getToken]);
  
  const registerAuthInterceptor = useCallback(async () => {
    try {
      // If an interceptor was already registered, remove it to prevent duplicates
      if (requestInterceptorId !== null) {
        api.interceptors.request.eject(requestInterceptorId);
        requestInterceptorId = null;
      }
      
      if (responseInterceptorId !== null) {
        api.interceptors.response.eject(responseInterceptorId);
        responseInterceptorId = null;
      }
      
      // Improved request interceptor
      requestInterceptorId = api.interceptors.request.use(async (config) => {
        try {
          // Update activity timestamp for any API request
          lastActivityTimestamp = Date.now();
          
          // Check if we need a token refresh
          const needsRefresh = !authToken || shouldRefreshToken(authToken);
          
          if (needsRefresh) {
            // For status endpoints, use special handling
            const isStatusEndpoint = config.url && (
              config.url.includes('/documents/status/') || 
              config.url.includes('/me/balance')
            );
            
            if (isStatusEndpoint) {
              config.headers['X-Is-Status-Check'] = 'true';
            }
            
            // Check if we've refreshed recently
            const now = Date.now();
            if (!window.__lastApiTokenRefresh) {
              window.__lastApiTokenRefresh = 0;
            }
      
            const timeSinceLastRefresh = now - window.__lastApiTokenRefresh;
      
            if (timeSinceLastRefresh < 5000) { // 5 seconds
              // If we've refreshed very recently, assume the token is valid
              // This prevents rapid succession of refresh attempts
              console.log(`Skipping token refresh - refreshed ${Math.round(timeSinceLastRefresh/1000)}s ago`);
            } else {
              console.log(`Token needs refresh for request: ${config.url}`);
              try {
                const token = await refreshToken();
                
                if (token) {
                  console.log(`New token applied to request: ${config.url}`);
                } else {
                  console.warn(`No auth token available for request: ${config.url}`);
                }
              } catch (refreshError) {
                // If refresh fails but we have an existing token, try to use it anyway
                if (authToken) {
                  console.warn(`Refresh failed but using existing token for: ${config.url}`);
                } else {
                  throw refreshError;
                }
              }
            }
          }
          
          // Add the token to the request if available
          if (authToken) {
            config.headers.Authorization = `Bearer ${authToken}`;
          }
          
          // Add CORS headers for all requests
          config.headers['Access-Control-Allow-Origin'] = '*';
          
          // Special handling for /documents/translate endpoint
          if (config.url && config.url.includes('/documents/translate')) {
            // Make sure content type is not being overridden for FormData
            if (config.data instanceof FormData) {
              // Don't set Content-Type for FormData - browser will set it with boundary
              delete config.headers['Content-Type'];
            }
            
            // Log detailed information about the request for debugging
            console.log(`Enhanced translation request headers:`, {
              url: config.url,
              method: config.method,
              hasAuth: !!config.headers.Authorization,
              contentType: config.headers['Content-Type'],
              isFormData: config.data instanceof FormData
            });
          }
        } catch (error) {
          console.error('Failed to retrieve authentication token:', error);
          
          // Add error header
          config.headers['X-Auth-Error'] = `${error.message || 'Unknown error'}`;
        }
        return config;
      });
      
      // Enhanced response interceptor with better error handling
      responseInterceptorId = api.interceptors.response.use(
        response => {
          // Check for token expiration warning headers
          if (response.headers['x-token-expiring-soon'] === 'true') {
            console.log('⚠️ Token is expiring soon according to server, refreshing...');
            
            // Get seconds until expiration from header if available
            const expiresInSeconds = response.headers['x-token-expires-in'] 
              ? parseInt(response.headers['x-token-expires-in'], 10) 
              : null;
              
            if (expiresInSeconds && expiresInSeconds < 300) { // Less than 5 minutes
              console.log(`⏰ Token expires in ${expiresInSeconds}s, refreshing now`);
              refreshToken(true).catch(err => console.error("Failed header-triggered refresh:", err));
            }
          }
          
          // Check for token refresh headers
          if (response.headers['x-token-refreshed'] === 'true') {
            console.log('🔄 Server indicates token was refreshed');
            // Force client-side token refresh to sync with server
            setTimeout(() => refreshToken(true), 500);
          }
          
          return response;
        },
        async error => {
          const originalRequest = error.config;
          
          // Don't retry requests that have already been retried or don't have a config
          if (!originalRequest || originalRequest._retry) {
            return Promise.reject(error);
          }
          
          // Handle 401 and 403 errors (authentication issues)
          if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            // Mark this request as retried to prevent infinite loops
            originalRequest._retry = true;
            
            console.warn(`⚠️ Auth error (${error.response.status}) for ${originalRequest.url}, refreshing token...`);
            
            // Check for token expired header
            const isTokenExpired = 
              error.response.headers['x-token-expired'] === 'true' || 
              error.response.data?.tokenExpired === true || 
              (error.response.data?.detail && 
               error.response.data.detail.toLowerCase().includes('expired'));
            
            // Special handling for status endpoint 403 errors
            const isStatusCheck = originalRequest.headers && 
                                originalRequest.headers['X-Is-Status-Check'] === 'true';
            
            if (isStatusCheck) {
              console.log('Status endpoint auth error, using aggressive refresh strategy');
            }
            
            try {
              // Force token clear for a fresh request
              authToken = null;
              tokenExpiryTime = null;
              
              // Get a new token directly from Clerk with fresh params
              const newToken = await window.Clerk.session.getToken({ 
                skipCache: true,
                expiration: 60 * 60 
              });
              
              if (newToken) {
                // Log the new token details
                logTokenInfo(newToken, "error-retry");
                
                console.log("✅ New token obtained after auth error, retrying request");
                
                // Update for future requests
                authToken = newToken;
                
                // Update the current request and retry
                originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
                
                // Track retry for status endpoint 403 errors
                if (isStatusCheck) {
                  originalRequest.headers['X-Status-Retry'] = 'true';
                }
                
                return api(originalRequest);
              }
            } catch (refreshError) {
              console.error('❌ Failed to refresh token during error recovery:', refreshError);
              
              // For status endpoints, return a defaulted value instead of error
              if (isStatusCheck) {
                console.log('Providing fallback for status endpoint');
                
                // Create a mock successful response with fallback data
                if (originalRequest.url.includes('/me/balance')) {
                  // Return mock balance data
                  return Promise.resolve({
                    data: {
                      userId: 'anonymous',
                      pagesBalance: 10,
                      pagesUsed: 0,
                      lastUsed: null,
                      isDefault: true,
                      authError: true
                    },
                    status: 200,
                    headers: {},
                    config: originalRequest
                  });
                } 
                else if (originalRequest.url.includes('/documents/status/')) {
                  // Extract processId from URL
                  const processId = originalRequest.url.split('/').pop();
                  
                  // Return mock status data
                  return Promise.resolve({
                    data: {
                      processId: processId,
                      status: 'pending',
                      progress: 0,
                      currentPage: 0,
                      totalPages: 0,
                      isFallback: true,
                      authError: true
                    },
                    status: 200,
                    headers: {},
                    config: originalRequest
                  });
                }
              }
            }
          }
          
          return Promise.reject(error);
        }
      );
      
      console.log('✅ Auth interceptor registered successfully');
      
      // Do an initial token fetch and setup refresh schedule
      try {
        console.log('🔍 Fetching initial token...');
        // Request a token with explicit expiration (1 hour)
        const token = await getToken({ 
          skipCache: true,
          expiration: 60 * 60 
        });
        
        if (token) {
          // Log and store token info
          logTokenInfo(token, "initial");
          authToken = token;
          
          // Setup auto-refresh before expiration
          scheduleTokenRefresh(token);
          
          console.log('✅ Initial token fetched successfully');
        }
      } catch (error) {
        console.error('❌ Failed to fetch initial token:', error);
      }
    } catch (error) {
      console.error("❌ Failed to register auth interceptor:", error);
    }
  }, [refreshToken, getToken, scheduleTokenRefresh]);
  
  // Keep token refreshed in the background and setup keepalive
  useEffect(() => {
    if (isSignedIn) {
      // Register the interceptor first
      registerAuthInterceptor();
      
      // Setup keepalive pings
      const cleanupKeepAlive = setupKeepAlive();
      
      // Return cleanup function
      return () => {
        // Clear token refresh timeout
        if (tokenRefreshTimeoutRef.current) {
          clearTimeout(tokenRefreshTimeoutRef.current);
          tokenRefreshTimeoutRef.current = null;
        }
        
        // Clean up keepalive
        cleanupKeepAlive();
        
        // Remove interceptors
        if (requestInterceptorId !== null) {
          api.interceptors.request.eject(requestInterceptorId);
          requestInterceptorId = null;
        }
        if (responseInterceptorId !== null) {
          api.interceptors.response.eject(responseInterceptorId);
          responseInterceptorId = null;
        }
      };
    }
  }, [isSignedIn, registerAuthInterceptor, setupKeepAlive]);
  
  return { 
    registerAuthInterceptor,
    refreshToken,
    getTokenDiagnostics,
    scheduleTokenRefresh
  };
};

// Document Service with Improved Authentication and Error Handling
export const documentService = {
  // Store ongoing requests to prevent duplicates
  _activeRequests: new Map(),
  
  // Store processId -> status mapping to provide fallback information
  _lastKnownStatus: new Map(),
  
  // Helper function to handle authentication errors
  _handleAuthError: async (error, endpoint, retryCallback) => {
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      console.warn(`⚠️ Authentication error for ${endpoint}, refreshing token and retrying...`);
      
      // Log details of the auth error for debugging
      console.log('Auth error details:', {
        status: error.response.status,
        statusText: error.response.statusText,
        url: error.config?.url,
        method: error.config?.method,
        hasAuthHeader: !!error.config?.headers?.Authorization
      });
      
      // Refresh token
      try {
        // Clear existing token to force refresh
        authToken = null;
        tokenExpiryTime = null;
        
        // Get a fresh token directly from Clerk
        const token = await window.Clerk.session.getToken({ 
          skipCache: true,
          expiration: 60 * 60 
        });
        
        if (token) {
          console.log(`✅ New token obtained after auth error for ${endpoint}`);
          
          // Store the new token
          authToken = token;
          
          // Parse the token to check expiration
          try {
            const parts = token.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(atob(parts[1]));
              if (payload.exp) {
                const expiresAt = new Date(payload.exp * 1000);
                console.log(`New token expires at: ${expiresAt.toISOString()}`);
              }
            }
          } catch (e) {
            console.warn('Error parsing token:', e);
          }
          
          // Wait a moment for token to propagate
          await new Promise(resolve => setTimeout(resolve, 300));
          
          // Retry the original request
          console.log(`Retrying ${endpoint} request with new token`);
          
          // Special handling for FormData
          let retry = retryCallback();
          
          // Add timeout to ensure we don't hang indefinitely
          const retryWithTimeout = Promise.race([
            retry,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Retry request timed out')), 20000)
            )
          ]);
          
          return await retryWithTimeout;
        } else {
          throw new Error('Failed to obtain new token');
        }
      } catch (retryError) {
        console.error(`❌ Retry after token refresh failed for ${endpoint}:`, retryError);
        
        // If this is a second-level retry for FormData, try a special approach
        if (endpoint === 'initiateTranslation' && error.config?.data instanceof FormData) {
          console.log('🔄 Attempting special FormData retry approach...');
          
          try {
            // Get a new token directly from Clerk in a different way
            const sessionToken = await window.Clerk.session.getToken();
            
            if (sessionToken) {
              // Create a new request manually with careful header handling
              const response = await fetch(error.config.url, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${sessionToken}`
                  // Deliberately not setting Content-Type for FormData
                },
                body: error.config.data, // Original FormData
                mode: 'cors',
                credentials: 'include'
              });
              
              if (response.ok) {
                console.log('✅ Special FormData retry succeeded!');
                const data = await response.json();
                return { data };
              } else {
                throw new Error(`Special retry failed with status: ${response.status}`);
              }
            }
          } catch (specialRetryError) {
            console.error('❌ Special FormData retry approach failed:', specialRetryError);
          }
        }
        
        throw retryError;
      }
    }
    throw error;
  },

  // Method to create a fallback status based on last known state for a process ID
  _createFallbackStatus: (processId) => {
    const lastStatus = documentService._lastKnownStatus.get(processId);
    
    if (lastStatus) {
      // Include a timestamp to indicate this is a fallback status
      return {
        ...lastStatus,
        isFallback: true,
        timestamp: Date.now()
      };
    }
    
    // Default fallback if we have no previous status
    return {
      processId: processId,
      status: 'pending',
      progress: 0,
      currentPage: 0,
      totalPages: 0,
      isFallback: true,
      timestamp: Date.now()
    };
  },
  
  // Method to update the last known status for a process ID
  _updateLastKnownStatus: (processId, statusData) => {
    documentService._lastKnownStatus.set(processId, {
      ...statusData,
      timestamp: Date.now()
    });
  },
  
  // List active translations
  listActiveTranslations: async () => {
    try {
      console.log("🔄 Fetching active translations...");
      const response = await api.get('/documents/active');
      console.log("✅ Retrieved active translations:", response.data.translations.length);
      return response.data.translations;
    } catch (error) {
      console.error("❌ Failed to fetch active translations:", error);
      return [];
    }
  },

  // Find translation by file name
  findTranslationByFile: async (fileName) => {
    try {
      console.log(`🔄 Searching for translation of file: ${fileName}`);
      const response = await api.get(`/documents/find?file_name=${encodeURIComponent(fileName)}`);
      console.log("✅ Found translation:", response.data);
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log("⚠️ No translation found for file:", fileName);
        return null;
      }
      console.error("❌ Error finding translation:", error);
      throw error;
    }
  },

  // that uses fetch API directly instead of axios
  initiateTranslation: async (formData) => {
    const startTime = Date.now();
    console.log(`🔄 [${new Date().toISOString()}] Initiating document translation with direct fetch API...`);
    
    // Extract file name for potential recovery
    const file = formData.get('file');
    const fileName = file ? file.name : 'unknown';
    console.log(`📄 Starting translation for file: ${fileName}`);
    
    try {
      // Force a fresh token before starting translation
      let token;
      try {
        // Clear any cached token
        authToken = null;
        
        // Get fresh token directly from Clerk
        token = await window.Clerk.session.getToken({ 
          skipCache: true,
          expiration: 60 * 60 
        });
        
        if (!token) {
          throw new Error("Failed to obtain authentication token");
        }
        
        console.log("✅ Fresh token obtained for direct fetch translation request");
      } catch (tokenError) {
        console.error("❌ Token fetch error:", tokenError);
        throw new Error("Authentication failed: " + (tokenError.message || "Unable to get token"));
      }
      
      // Log FormData contents for debugging
      console.log('FormData contains:');
      for (let key of formData.keys()) {
        const value = formData.get(key);
        if (value instanceof File) {
          console.log(`- ${key}: File (${value.name}, ${value.type}, ${value.size} bytes)`);
        } else {
          console.log(`- ${key}: ${value}`);
        }
      }
      
      // Construct the full URL
      const baseUrl = import.meta.env.VITE_API_URL || '/api';
      const url = `${baseUrl}/documents/translate`;
      console.log(`🔄 Direct fetch to URL: ${url}`);
      
      // Use fetch API directly instead of axios
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
          // No Content-Type header for FormData - browser sets it with boundary
        },
        body: formData, // FormData is handled correctly by fetch
        credentials: 'include', // Send cookies if needed
        mode: 'cors' // Enable CORS
      });
      
      // Handle response
      if (!response.ok) {
        // Handle error response
        let errorDetails = {
          status: response.status,
          statusText: response.statusText
        };
        
        try {
          // Try to parse error response body
          const errorData = await response.json();
          errorDetails.data = errorData;
          
          throw new Error(`Server returned ${response.status} ${response.statusText}: ${JSON.stringify(errorData)}`);
        } catch (parseError) {
          // If we can't parse JSON, just use status text
          throw new Error(`Server returned ${response.status} ${response.statusText}`);
        }
      }
      
      // Parse successful response
      const data = await response.json();
      
      const duration = Date.now() - startTime;
      console.log(`✅ [${new Date().toISOString()}] Translation initiated successfully with direct fetch in ${duration}ms, processId: ${data.processId}`);
      
      // Store in local storage for recovery purposes
      try {
        const translationInfo = {
          processId: data.processId,
          fileName: fileName,
          timestamp: Date.now(),
          status: data.status || 'pending'
        };
        
        // Keep a history of recent translations for recovery
        const recentTranslations = JSON.parse(localStorage.getItem('recentTranslations') || '[]');
        recentTranslations.unshift(translationInfo); // Add to beginning
        
        // Keep only last 10
        if (recentTranslations.length > 10) {
          recentTranslations.pop();
        }
        
        localStorage.setItem('recentTranslations', JSON.stringify(recentTranslations));
        console.log("📦 Saved translation info to local storage for recovery");
      } catch (storageError) {
        console.warn("⚠️ Failed to save to local storage:", storageError);
      }
      
      return data;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [${new Date().toISOString()}] Translation initiation failed after ${duration}ms:`, error);
      
      // For timeouts, try to recover by finding active translations
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        console.log("⏳ Upload request timed out, but the server might still be processing it");
        
        // Try to find the translation using the backend API
        try {
          // Give the server a moment to create the record
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const foundTranslation = await documentService.findTranslationByFile(fileName);
          if (foundTranslation) {
            console.log("🔍 Found translation after timeout:", foundTranslation.processId);
            // Return the found translation
            return {
              success: true,
              message: "Translation process found after timeout",
              processId: foundTranslation.processId,
              status: foundTranslation.status,
              recoveredAfterTimeout: true
            };
          }
        } catch (recoveryError) {
          console.warn("⚠️ Failed to recover translation after timeout:", recoveryError);
        }
      }
      
      // Rethrow with improved error message
      throw error;
    }
  },

  checkTranslationStatusWithToken: async (processId, token = null) => {
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
      try {
        // Create request options with the token if provided
        const requestOptions = {
          headers: {},
          timeout: 15000 // 15 seconds timeout
        };
        
        // Add token to this specific request if provided
        if (token) {
          requestOptions.headers['Authorization'] = `Bearer ${token}`;
        }
        
        // Add additional headers to help with debugging
        requestOptions.headers['X-Is-Status-Check'] = 'true';
        requestOptions.headers['X-Check-Count'] = retryCount;
        requestOptions.headers['X-Check-Time'] = Date.now();
        
        // Use api with the specific options
        const response = await api.get(`/documents/status/${processId}`, requestOptions);
        
        // Store the successful status for fallback
        documentService._updateLastKnownStatus(processId, response.data);
        
        // Update lastActivityTimestamp to prevent session timeout
        lastActivityTimestamp = Date.now();
        
        return response.data;
      } catch (error) {
        // No retries for network errors, just use fallback status
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout') || !error.response) {
          console.warn(`Network issue while checking status for ${processId} - using fallback status`);
          return {
            processId: processId,
            status: 'pending',
            progress: 0,
            currentPage: 0,
            totalPages: 0,
            isNetworkEstimate: true,
            networkError: error.message
          };
        }
        
        // Handle auth errors by getting a fresh token for the retry
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`Auth error (${error.response.status}) in status check, retry #${retryCount}/${maxRetries}`);
            
            try {
              // Try to get a fresh token for next attempt
              const freshToken = await window.Clerk.session.getToken({
                skipCache: true,
                expiration: 60 * 60
              });
              
              if (freshToken) {
                token = freshToken; // Update token for next attempt
                console.log(`Got fresh token for retry #${retryCount}`);
                
                // Wait a short time before retrying
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Continue to next retry iteration
                continue;
              }
            } catch (tokenError) {
              console.warn(`Failed to get fresh token for retry #${retryCount}:`, tokenError);
            }
          }
          
          // If max retries reached, return fallback status
          console.log(`Auth errors persist after ${retryCount} retries, using fallback status`);
          return documentService._createFallbackStatus(processId);
        }
        
        // For other errors, retry if we haven't reached max attempts
        if (retryCount < maxRetries) {
          retryCount++;
          
          // Exponential backoff for retries
          const backoffTime = Math.pow(2, retryCount) * 500; // 1s, 2s, 4s...
          console.log(`Retrying status check in ${backoffTime}ms (attempt ${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          
          continue; // Try again
        }
        
        // Exhaused retries, return fallback
        return documentService._createFallbackStatus(processId);
      }
    }
    
    // If we somehow exit the loop without returning, use fallback
    return documentService._createFallbackStatus(processId);
  },
  
  exportToPdf: async (text, fileName) => {
    console.log(`🔄 Exporting document to PDF: ${fileName}...`);
    try {
      const response = await api.post('/export/pdf', { text, fileName });
      console.log('✅ PDF exported successfully');
      return response.data;
    } catch (error) {
      console.error('❌ PDF export failed:', error);
      
      // Handle authentication errors
      if (error.response && error.response.status === 401) {
        try {
          return await documentService._handleAuthError(
            error, 
            'exportPdf', 
            () => api.post('/export/pdf', { text, fileName })
          ).then(response => response.data);
        } catch (retryError) {
          // If retry fails, continue with normal error handling
        }
      }
      
      throw error.response?.data?.error || 'Export to PDF failed.';
    }
  },

  exportToDocx: async (text, fileName) => {
    console.log(`🔄 Exporting document to DOCX: ${fileName}...`);
    try {
      const response = await api.post('/export/docx', { text, fileName });
      console.log('✅ DOCX exported successfully');
      return response.data;
    } catch (error) {
      console.error('❌ DOCX export failed:', error);
      
      // Handle authentication errors
      if (error.response && error.response.status === 401) {
        try {
          return await documentService._handleAuthError(
            error, 
            'exportDocx', 
            () => api.post('/export/docx', { text, fileName })
          ).then(response => response.data);
        } catch (retryError) {
          // If retry fails, continue with normal error handling
        }
      }
      
      throw error.response?.data?.error || 'Export to DOCX failed.';
    }
  },
  getTranslationResultWithToken: async (processId, allowPartial = false, token = null) => {
    // Deduplicate concurrent result fetches for the same processId
    const requestKey = `result-${processId}-${allowPartial ? 'partial' : 'complete'}`;
    
    // Create an AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15-second timeout for results
    
    const startTime = Date.now();
    console.log(`🔄 [${new Date().toISOString()}] Fetching translation result for process: ${processId} (partial=${allowPartial})`);
    
    try {
      const url = allowPartial 
        ? `documents/result/${processId}?partial=true` 
        : `documents/result/${processId}`;
      
      // Prepare request options
      const requestOptions = {
        signal: controller.signal,
        timeout: 15000
      };
      
      // Add token if provided (bypassing global token)
      if (token) {
        requestOptions.headers = {
          'Authorization': `Bearer ${token}`
        };
      }
      
      const response = await api.get(url, requestOptions);
      
      // Clear timeout
      clearTimeout(timeoutId);
      
      const duration = Date.now() - startTime;
      console.log(`✅ [${new Date().toISOString()}] Translation result fetched successfully in ${duration}ms, content length: ${response.data.translatedText?.length || 0} chars`);
      
      // Update status to completed in our cache
      documentService._updateLastKnownStatus(processId, {
        processId: processId,
        status: allowPartial ? 'partial' : 'completed',
        progress: allowPartial ? Math.min(95, response.data.metadata?.progress || 0) : 100,
        currentPage: response.data.metadata?.currentPage || 0,
        totalPages: response.data.metadata?.totalPages || 0
      });
      
      return response.data;
    } catch (error) {
      // Clear timeout
      clearTimeout(timeoutId);
      
      const duration = Date.now() - startTime;
      console.error(`❌ [${new Date().toISOString()}] Result fetch failed after ${duration}ms:`, error);
      
      // Handle auth errors (401/403)
      if (error.response && (error.response.status === 401 || error.response.status === 403)) {
        console.log("🔐 Auth error when fetching results, trying with fresh token");
        
        try {
          // Get a fresh token directly from Clerk
          const freshToken = await window.Clerk.session.getToken({
            skipCache: true,
            expiration: 60 * 60
          });
          
          if (freshToken) {
            console.log("✅ Got fresh token for result fetch retry");
            
            // Retry with the fresh token
            const retryOptions = {
              headers: {
                'Authorization': `Bearer ${freshToken}`
              },
              timeout: 15000
            };
            
            const retryResponse = await api.get(url, retryOptions);
            console.log("✅ Result fetch retry succeeded with fresh token");
            return retryResponse.data;
          }
        } catch (retryError) {
          console.error("❌ Result fetch retry also failed:", retryError);
          // Continue to general error handling
        }
      }
      
      // Handle timeouts
      if (
        error.name === 'AbortError' || 
        error.code === 'ECONNABORTED' || 
        error.message.includes('timeout')
      ) {
        throw new Error('Request timed out while fetching translation results. The server might be busy processing a large document. Please try again in a moment.');
      }
      
      // Enhanced error handling with specific error messages
      if (error.response?.status === 404) {
        throw new Error('Translation not found. The process may have expired.');
      } else if (error.response?.status === 400) {
        throw new Error('Translation is not yet complete. Please wait until it finishes processing.');
      }
      
      throw new Error('Failed to fetch translation result. Please try again later.');
    }
  },
  
  exportToDriveAsPdf: async (content, fileName, options = {}) => {
    console.log(`🔄 Exporting to Google Drive as PDF: ${fileName}...`);
    try {
      const response = await api.post('/export/pdf', {
        text: content,
        fileName,
        saveToGoogleDrive: true,
        createFolder: options.createFolder || false,
        folderName: options.folderName || '',
        folderId: options.folderId || null
      });
      console.log('✅ PDF exported to Drive successfully');
      return response.data;
    } catch (error) {
      console.error('❌ Export to Google Drive as PDF failed:', error);
      throw error;
    }
  },
  
  exportToDriveAsDocx: async (content, fileName, options = {}) => {
    console.log(`🔄 Exporting to Google Drive as DOCX: ${fileName}...`);
    try {
      const response = await api.post('/export/docx', {
        text: content,
        fileName,
        saveToGoogleDrive: true,
        folderId: options.folderId || null,
        createFolder: options.createFolder || false,
        folderName: options.folderName || '',
      });
      console.log('✅ DOCX exported to Drive successfully');
      return response.data;
    } catch (error) {
      console.error('❌ Export to Google Drive as DOCX failed:', error);
      throw error;
    }
  },

  getTranslationResult: async (processId, allowPartial = false) => {
    // Deduplicate concurrent result fetches for the same processId
    const requestKey = `result-${processId}-${allowPartial ? 'partial' : 'complete'}`;
    
    // If there's already an active request for this processId, return its promise
    if (documentService._activeRequests.has(requestKey)) {
      console.log(`⏳ [${new Date().toISOString()}] Reusing existing result fetch for process: ${processId}`);
      return documentService._activeRequests.get(requestKey);
    }
    
    // Create an AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15-second timeout for results
    
    const startTime = Date.now();
    console.log(`🔄 [${new Date().toISOString()}] Fetching translation result for process: ${processId} (partial=${allowPartial})`);
    
    // Create the promise for this request
    const requestPromise = (async () => {
      try {
        const url = allowPartial 
          ? `documents/result/${processId}?partial=true` 
          : `documents/result/${processId}`;
        
        const response = await api.get(url, {
          signal: controller.signal,
          timeout: 15000
        });
        
        // Clear timeout
        clearTimeout(timeoutId);
        
        const duration = Date.now() - startTime;
        console.log(`✅ [${new Date().toISOString()}] Translation result fetched successfully in ${duration}ms, content length: ${response.data.translatedText?.length || 0} chars`);
        
        // Update status to completed in our cache
        documentService._updateLastKnownStatus(processId, {
          processId: processId,
          status: allowPartial ? 'partial' : 'completed',
          progress: allowPartial ? Math.min(95, response.data.metadata?.progress || 0) : 100,
          currentPage: response.data.metadata?.currentPage || 0,
          totalPages: response.data.metadata?.totalPages || 0
        });
        
        return response.data;
      } catch (error) {
        // Clear timeout
        clearTimeout(timeoutId);
        
        const duration = Date.now() - startTime;
        console.error(`❌ [${new Date().toISOString()}] Result fetch failed after ${duration}ms:`, error);
        
        // Handle timeouts
        if (
          error.name === 'AbortError' || 
          error.code === 'ECONNABORTED' || 
          error.message.includes('timeout')
        ) {
          throw new Error('Request timed out while fetching translation results. The server might be busy processing a large document. Please try again in a moment.');
        }
        
        // Handle authentication errors
        if (error.response && error.response.status === 401) {
          try {
            return await documentService._handleAuthError(
              error, 
              'result', 
              () => api.get(allowPartial ? `documents/result/${processId}?partial=true` : `documents/result/${processId}`)
            ).then(response => response.data);
          } catch (retryError) {
            // If retry fails, continue with normal error handling
          }
        }
        
        // Enhanced error handling with specific error messages
        if (error.response?.status === 404) {
          throw new Error('Translation not found. The process may have expired.');
        } else if (error.response?.status === 400) {
          throw new Error('Translation is not yet complete. Please wait until it finishes processing.');
        }
        
        throw new Error('Failed to fetch translation result. Please try again later.');
      } finally {
        // Remove this request from the active requests map
        documentService._activeRequests.delete(requestKey);
      }
    })();
    
    // Store the promise in the active requests map
    documentService._activeRequests.set(requestKey, requestPromise);
    
    return requestPromise;
  }
};

// Translation History Service
export const historyService = {
  // Get recent completed translations
  getRecentTranslations: async (limit = 2) => {
    console.log(`🔄 Fetching recent translations (limit: ${limit})...`);
    try {
      // Try to fetch from the API endpoint first
      try {
        const response = await api.get(`/history/history?limit=${limit}`);
        console.log('✅ Recent translations fetched successfully:', response.data);
        return response.data;
      } catch (error) {
        // If the endpoint isn't ready yet, use mock data
        if (error.response?.status === 404 || 
            error.message?.includes('failed') || 
            !error.response?.headers?.['content-type']?.includes('application/json')) {
          console.warn('⚠️ History API not available, using mock data');
          
          // Create mock data for development
          return {
            history: [
              {
                processId: 'mock-id-1',
                fileName: 'Business Contract.pdf',
                fromLang: 'en',
                toLang: 'ru',
                status: 'completed',
                totalPages: 5,
                completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
              },
              {
                processId: 'mock-id-2',
                fileName: 'Travel Itinerary.pdf',
                fromLang: 'en',
                toLang: 'es',
                status: 'completed',
                totalPages: 2,
                completedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
                createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 3600000).toISOString()
              }
            ],
            total: 2
          };
        }
        
        // If it's another type of error, rethrow it
        throw error;
      }
    } catch (error) {
      console.error('❌ Failed to fetch recent translations:', error);
      throw error;
    }
  },
  
  // Get translation preview
  getTranslationPreview: async (processId) => {
    console.log(`🔄 Fetching preview for translation: ${processId}...`);
    try {
      const response = await api.get(`/history/history/${processId}/preview`);
      console.log('✅ Translation preview fetched successfully');
      return response.data;
    } catch (error) {
      // If the endpoint isn't ready yet, use mock data
      if (error.response?.status === 404 || 
          error.message?.includes('failed') || 
          !error.response?.headers?.['content-type']?.includes('application/json')) {
        console.warn('⚠️ Preview API not available, using mock data');
        
        // Create mock preview data
        return {
          processId: processId,
          preview: `<div class="document">
            <div class="page">
              <h1>Sample Translated Document</h1>
              <p>This is a sample of translated content. In a real application, this would be the actual translated content from your document.</p>
              <p>The document would maintain its original formatting as much as possible, including:</p>
              <ul>
                <li>Headings and paragraphs</li>
                <li>Lists and bullet points</li>
                <li>Tables and other structured content</li>
              </ul>
              <p>The translation would preserve the document's layout while translating the text to your target language.</p>
            </div>
          </div>`,
          hasContent: true,
          totalChunks: 1,
          metadata: {
            fileName: processId === 'mock-id-1' ? 'Business Contract.pdf' : 'Travel Itinerary.pdf',
            fromLang: processId === 'mock-id-1' ? 'en' : 'en',
            toLang: processId === 'mock-id-1' ? 'ru' : 'es',
            totalPages: processId === 'mock-id-1' ? 5 : 2,
            completedAt: processId === 'mock-id-1' 
              ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
              : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
          }
        };
      }
      
      console.error('❌ Failed to fetch translation preview:', error);
      throw error;
    }
  },
  
  // Get full translation content
  getTranslationContent: async (processId) => {
    console.log(`🔄 Fetching full content for translation: ${processId}...`);
    try {
      const response = await api.get(`/history/history/${processId}/content`);
      console.log('✅ Translation content fetched successfully');
      return response.data;
    } catch (error) {
      // If the endpoint isn't ready yet, use mock data
      if (error.response?.status === 404 || 
          error.message?.includes('failed') || 
          !error.response?.headers?.['content-type']?.includes('application/json')) {
        console.warn('⚠️ Content API not available, using mock data');
        
        // Create mock full content
        return {
          processId: processId,
          chunks: [
            {
              pageNumber: 1,
              content: `<div class="page">
                <h1>Full Translation Document</h1>
                <p>This is page 1 of the mock translated document. This simulates the content you would see when viewing a full translation.</p>
                <p>Real content would preserve the original document's formatting and layout.</p>
              </div>`
            },
            {
              pageNumber: 2,
              content: `<div class="page">
                <h2>Page 2 Content</h2>
                <p>This is the second page of the mock translated document.</p>
                <p>In a real application, this would contain the actual translated content from your document.</p>
              </div>`
            }
          ],
          combinedContent: `<div class="document">
            <div class="page" id="page-1">
              <h1>Full Translation Document</h1>
              <p>This is page 1 of the mock translated document. This simulates the content you would see when viewing a full translation.</p>
              <p>Real content would preserve the original document's formatting and layout.</p>
            </div>
            <div class="page" id="page-2">
              <h2>Page 2 Content</h2>
              <p>This is the second page of the mock translated document.</p>
              <p>In a real application, this would contain the actual translated content from your document.</p>
            </div>
          </div>`,
          hasContent: true,
          metadata: {
            fileName: processId === 'mock-id-1' ? 'Business Contract.pdf' : 'Travel Itinerary.pdf',
            fromLang: processId === 'mock-id-1' ? 'en' : 'en',
            toLang: processId === 'mock-id-1' ? 'ru' : 'es',
            totalPages: processId === 'mock-id-1' ? 5 : 2,
            status: 'completed',
            fileType: 'application/pdf',
            createdAt: processId === 'mock-id-1' 
              ? new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
              : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 3600000).toISOString(),
            completedAt: processId === 'mock-id-1' 
              ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
              : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            direction: 'ltr'
          }
        };
      }
      
      console.error('❌ Failed to fetch translation content:', error);
      throw error;
    }
  },
  
  // Get user's translation statistics
  getTranslationStats: async () => {
    console.log('🔄 Fetching translation statistics...');
    try {
      // This endpoint doesn't exist yet - implement it later
      // For now, return mock data
      return {
        totalTranslations: 5,
        totalPages: 14,
        mostRecentDate: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Failed to fetch translation statistics:', error);
      throw error;
    }
  }
};

// Add a global function for checking token info from browser console
window.checkTokenInfo = async () => {
  try {
    // Get token from Clerk
    const token = await window.Clerk.session.getToken({ expiration: 60 * 60 });
    return logTokenInfo(token, "manual-check");
  } catch (error) {
    console.error('Error checking token info:', error);
    return { error: String(error) };
  }
};

window.debugTokenStatus = async () => {
  try {
    // Check current token
    if (authToken) {
      const decoded = decodeToken(authToken);
      if (decoded && decoded.exp) {
        const now = Math.floor(Date.now() / 1000);
        const remaining = decoded.exp - now;
        console.log(`Current token expires in ${remaining} seconds`);
        
        // Show if token is expired
        if (remaining <= 0) {
          console.error('TOKEN IS EXPIRED');
        }
      }
    } else {
      console.warn('No auth token available');
    }
    
    // Show token refresh history
    try {
      const tokenHistory = JSON.parse(localStorage.getItem('tokenHistory') || '[]');
      console.log('Token refresh history:', tokenHistory);
    } catch (e) {
      console.warn('Failed to retrieve token history:', e);
    }
    
    // Show current status
    console.log('Current token status:');
    console.log('- Auth token exists:', !!authToken);
    console.log('- Token expiry time:', tokenExpiryTime ? new Date(tokenExpiryTime).toISOString() : 'N/A');
    console.log('- Currently refreshing:', isRefreshing);
    console.log('- Callbacks waiting:', refreshCallbacks.length);
    
    return {
      tokenExists: !!authToken,
      tokenExpiry: tokenExpiryTime ? new Date(tokenExpiryTime).toISOString() : null,
      isRefreshing,
      callbacksWaiting: refreshCallbacks.length,
      lastActivity: lastActivityTimestamp ? new Date(lastActivityTimestamp).toISOString() : null
    };
  } catch (error) {
    console.error('Error in debugTokenStatus:', error);
    return { error: String(error) };
  }
};

// Export the API instance
export default api;