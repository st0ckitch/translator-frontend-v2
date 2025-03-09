import { useEffect, useRef, useState } from 'react';
import { useApiAuth } from '../services/api';
import api from '../services/api';
import { toast } from 'sonner';

// More conservative error handling parameters
const AUTH_ERROR_THRESHOLD = 3; // More errors before notification
const AUTH_ERROR_RESET_TIME = 60000; // 1 minute
const REFRESH_COOLDOWN = 120000; // 2 minutes between refresh attempts

// Global auth error state
let globalAuthErrorCount = 0;
let lastAuthErrorTime = 0;

export default function TokenStatusMonitor() {
  const { refreshToken } = useApiAuth();
  const [isTokenRefreshing, setIsTokenRefreshing] = useState(false);
  const refreshTimeoutRef = useRef(null);
  const lastRefreshRef = useRef(0);
  
  // Rate limiting for refreshes
  const canRefresh = () => {
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshRef.current;
    return timeSinceLastRefresh > REFRESH_COOLDOWN;
  };

  // Handle authentication errors with rate limiting
  const handleAuthError = async (source) => {
    // Rate limiting logic
    const now = Date.now();
    
    // Reset counter after sufficient time
    if (now - lastAuthErrorTime > AUTH_ERROR_RESET_TIME) {
      globalAuthErrorCount = 0;
    }
    
    // Update error tracking
    lastAuthErrorTime = now;
    globalAuthErrorCount++;
    
    // Skip if we're already refreshing or too soon
    if (isTokenRefreshing || !canRefresh()) {
      return;
    }
    
    // Only show notification after multiple errors
    if (globalAuthErrorCount >= AUTH_ERROR_THRESHOLD) {
      toast.warning('Session refresh needed', {
        description: 'Refreshing authentication...',
        id: 'auth-refresh-toast',
        duration: 5000
      });
    }
    
    // Start token refresh
    try {
      setIsTokenRefreshing(true);
      lastRefreshRef.current = Date.now();
      
      // Clear any existing timeout
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      
      // Add delay to prevent race conditions
      refreshTimeoutRef.current = setTimeout(async () => {
        try {
          await refreshToken(true);
          
          // Only show success toast if we showed an error before
          if (globalAuthErrorCount >= AUTH_ERROR_THRESHOLD) {
            toast.success('Session refreshed successfully', {
              id: 'auth-refresh-toast',
              duration: 3000
            });
          }
          
          // Reset error count
          globalAuthErrorCount = 0;
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
          
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
      }, 500);
    } catch (error) {
      console.error('Error handling auth error:', error);
      setIsTokenRefreshing(false);
    }
  };
  
  // Setup listener for API auth errors
  useEffect(() => {
    const handleApiAuthError = (event) => {
      if (
        event.detail &&
        event.detail.error &&
        event.detail.source &&
        (event.detail.status === 401 || event.detail.status === 403)
      ) {
        handleAuthError(event.detail.source);
      }
    };
    
    // Setup global auth error event listener
    window.addEventListener('api-auth-error', handleApiAuthError);
    
    // Expose function for reporting auth errors
    window.reportAuthError = (source) => {
      handleAuthError(source || 'unknown');
      
      // Dispatch tracking event
      const authErrorEvent = new CustomEvent('api-auth-error', {
        detail: {
          source,
          time: Date.now()
        }
      });
      window.dispatchEvent(authErrorEvent);
    };
    
    return () => {
      window.removeEventListener('api-auth-error', handleApiAuthError);
      
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);
  
  // No visible UI
  return null;
}