// src/components/TokenStatusMonitor.jsx - Optimized auth error handling
import { useEffect, useRef, useState } from 'react';
import { useApiAuth } from '../services/api';
import api from '../services/api';
import { toast } from 'sonner';

// Create a global auth error handler with rate limiting
let globalAuthErrorCount = 0;
let lastAuthErrorTime = 0;
const AUTH_ERROR_THRESHOLD = 2; // Number of auth errors before showing notification
const AUTH_ERROR_RESET_TIME = 30000; // 30 seconds - time to reset error count
const REFRESH_COOLDOWN = 30000; // 30 seconds between refresh attempts

export default function TokenStatusMonitor() {
  const { refreshToken } = useApiAuth();
  const [isTokenRefreshing, setIsTokenRefreshing] = useState(false);
  const refreshTimeoutRef = useRef(null);
  const lastRefreshRef = useRef(0);
  
  // Prevent rapid, concurrent refreshes
  const canRefresh = () => {
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshRef.current;
    
    // Enforce minimum time between refreshes
    return timeSinceLastRefresh > REFRESH_COOLDOWN;
  };

  // Function to handle a 403 error by refreshing token
  const handleAuthError = async (source) => {
    // Track global auth errors to prevent spam
    const now = Date.now();
    
    // If it's been more than 30 seconds since last error, reset counter
    if (now - lastAuthErrorTime > AUTH_ERROR_RESET_TIME) {
      globalAuthErrorCount = 0;
    }
    
    // Update last error time and increment counter
    lastAuthErrorTime = now;
    globalAuthErrorCount++;
    
    // Log the error
    console.warn(`🔒 Auth error detected from ${source} (count: ${globalAuthErrorCount})`);
    
    // If we're already refreshing, don't start another refresh
    if (isTokenRefreshing || !canRefresh()) {
      console.log('Token already refreshing or too soon since last refresh, skipping');
      return;
    }
    
    // Show notification if we've hit the threshold
    if (globalAuthErrorCount >= AUTH_ERROR_THRESHOLD) {
      toast.warning('Session needs to be refreshed', {
        description: 'Refreshing authentication...',
        id: 'auth-refresh-toast',
        duration: 5000
      });
    }
    
    // Start token refresh
    try {
      setIsTokenRefreshing(true);
      lastRefreshRef.current = Date.now();
      
      // Use setTimeout to prevent multiple refresh attempts
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      
      // Slight delay to prevent race conditions
      refreshTimeoutRef.current = setTimeout(async () => {
        try {
          // Force token refresh
          await refreshToken(true);
          
          console.log('✅ Token refreshed after auth error');
          
          // Reset auth error count
          globalAuthErrorCount = 0;
          
          // Show success toast if we showed an error before
          if (globalAuthErrorCount >= AUTH_ERROR_THRESHOLD) {
            toast.success('Session refreshed successfully', {
              id: 'auth-refresh-toast',
              duration: 3000
            });
          }
        } catch (refreshError) {
          console.error('Failed to refresh token after auth error:', refreshError);
          
          if (globalAuthErrorCount >= AUTH_ERROR_THRESHOLD) {
            toast.error('Failed to refresh session', {
              description: 'You may need to log out and back in',
              duration: 5000
            });
          }
        } finally {
          setIsTokenRefreshing(false);
          refreshTimeoutRef.current = null;
        }
      }, 300); // Small delay to prevent multiple refreshes
    } catch (error) {
      console.error('Error handling auth error:', error);
      setIsTokenRefreshing(false);
    }
  };
  
  // Setup global listeners for API auth errors
  useEffect(() => {
    // Create a global handler for auth errors
    const handleApiAuthError = (event) => {
      // Check if this is an auth error response from our API
      if (
        event.detail &&
        event.detail.error &&
        event.detail.source &&
        (event.detail.status === 401 || event.detail.status === 403)
      ) {
        handleAuthError(event.detail.source);
      }
    };
    
    // Create custom event for auth errors
    window.addEventListener('api-auth-error', handleApiAuthError);
    
    // Expose global function for other parts of the app to report auth errors
    window.reportAuthError = (source) => {
      handleAuthError(source || 'unknown');
      
      // Dispatch event for tracking
      const authErrorEvent = new CustomEvent('api-auth-error', {
        detail: {
          source,
          time: Date.now()
        }
      });
      window.dispatchEvent(authErrorEvent);
    };
    
    return () => {
      // Clean up listeners
      window.removeEventListener('api-auth-error', handleApiAuthError);
      
      // Clear timeout
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);
  
  // This component doesn't render anything visible
  return null;
}