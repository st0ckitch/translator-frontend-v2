// src/components/TokenKeepalive.jsx
import { useEffect, useRef, useState } from 'react';
import { useApiAuth } from '../services/api';
import { useUser, useAuth } from '@clerk/clerk-react';

// Optimized for 1-minute token lifespans
const TOKEN_REFRESH_INTERVAL = 40 * 1000; // 40 seconds
const INACTIVITY_THRESHOLD = 2 * 60 * 1000; // 2 minutes
const MIN_REFRESH_INTERVAL = 30 * 1000; // 30 seconds minimum between refreshes

export default function TokenKeepalive() {
  const { isSignedIn } = useUser();
  const { getToken } = useAuth();
  const { refreshToken, getTokenDiagnostics } = useApiAuth();
  const refreshIntervalRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const lastRefreshRef = useRef(0);
  const tokenExpiryRef = useRef(0);
  const [debugInfo, setDebugInfo] = useState(null);
  
  // Initialize global variables safely to prevent reference errors
  // This runs once on component mount
  useEffect(() => {
    // Defensive initialization of global objects
    if (typeof window !== 'undefined') {
      // Ensure we have safe global objects
      if (!window.hasOwnProperty('__lastApiTokenRefresh')) {
        window.__lastApiTokenRefresh = 0;
      }
      
      if (!window.hasOwnProperty('authToken')) {
        window.authToken = null;
      }
      
      if (!window.hasOwnProperty('tokenExpiryTime')) {
        window.tokenExpiryTime = null;
      }
      
      // Only log in development
      if (process.env.NODE_ENV !== 'production') {
        console.log('TokenKeepalive: Initialized safe global references');
      }
    }
  }, []);
  
  // Rate limiting for refreshes
  const canRefresh = () => {
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshRef.current;
    return timeSinceLastRefresh > MIN_REFRESH_INTERVAL;
  };

  // Update last activity timestamp with throttling
  useEffect(() => {
    let lastUpdateTime = 0;
    const THROTTLE_TIME = 10000; // 10 second throttle
    
    const updateLastActivity = () => {
      const now = Date.now();
      if (now - lastUpdateTime > THROTTLE_TIME) {
        lastActivityRef.current = now;
        lastUpdateTime = now;
      }
    };
    
    // Only track essential events
    const events = ['mousedown', 'keydown'];
    events.forEach(event => {
      window.addEventListener(event, updateLastActivity, { passive: true });
    });
    
    return () => {
      events.forEach(event => {
        window.removeEventListener(event, updateLastActivity);
      });
    };
  }, []);
  
  // Smart token management that deals with short-lived tokens
  useEffect(() => {
    if (!isSignedIn) return;
    
    // Only check if we really need a token refresh
    const checkTokenStatus = async () => {
      try {
        // If we've refreshed recently, skip
        if (!canRefresh()) {
          return;
        }
        
        // Check current token expiry
        const now = Date.now();
        const tokenInfo = await getTokenDiagnostics();
        setDebugInfo(tokenInfo);
        
        // Calculate seconds until expiration
        const secondsRemaining = tokenInfo?.currentToken?.remainingMinutes * 60 || 0;
        
        // Calculate timings
        const expiresAt = now + (secondsRemaining * 1000);
        tokenExpiryRef.current = expiresAt;
        
        // For 1-minute tokens, need to refresh when 15 seconds remaining
        const shouldRefresh = secondsRemaining < 15;
        
        if (shouldRefresh) {
          console.log(`Token refresh needed: ${secondsRemaining} seconds remaining`);
          
          // Remember last refresh time
          lastRefreshRef.current = now;
          
          // Get a fresh token directly from Clerk with longer expiration request
          try {
            const token = await getToken({ 
              skipCache: true,
              expiration: 60 * 60 // Request 1 hour - Clerk might not honor this
            });
            
            if (token) {
              console.log('Token refreshed via direct Clerk call');
              
              // Parse the token to see if we got a longer expiration
              try {
                const parts = token.split('.');
                if (parts.length === 3) {
                  const payload = JSON.parse(atob(parts[1]));
                  if (payload.exp) {
                    const expiresAt = new Date(payload.exp * 1000);
                    console.log(`New token expires at: ${expiresAt.toISOString()}`);
                    tokenExpiryRef.current = payload.exp * 1000;
                  }
                }
              } catch (e) {
                console.warn('Error parsing token:', e);
              }
            }
          } catch (err) {
            console.error('Error refreshing token via Clerk:', err);
            // Fallback to API auth refresh
            await refreshToken(true);
          }
        }
      } catch (error) {
        console.error('Failed to check token status:', error);
      }
    };
    
    // Initial check with delay
    const initialTimer = setTimeout(() => {
      checkTokenStatus();
    }, 5000);
    
    // Setup interval for recurring checks
    refreshIntervalRef.current = setInterval(checkTokenStatus, TOKEN_REFRESH_INTERVAL);
    
    return () => {
      clearTimeout(initialTimer);
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [isSignedIn, refreshToken, getTokenDiagnostics, getToken]);
  
  // No visible UI
  return null;
}