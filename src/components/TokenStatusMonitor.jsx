// src/components/TokenStatusMonitor.jsx
import { useEffect, useRef, useState } from 'react';
import { useApiAuth } from '../services/api';
import { useAuth } from '@clerk/clerk-react';
import api from '../services/api';
import { toast } from 'sonner';

// Globally track auth errors with rate limiting
let globalAuthErrorCount = 0;
let lastAuthErrorTime = 0;
const AUTH_ERROR_THRESHOLD = 2; // Show notification after this many errors
const AUTH_ERROR_RESET_TIME = 30000; // 30 seconds to reset error count
const REFRESH_COOLDOWN = 45000; // 45 seconds between refresh attempts

export default function TokenStatusMonitor() {
  const { getToken } = useAuth();
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

  // Smarter auth error handling for short-lived tokens
  const handleAuthError = async (source) => {
    // Track errors with rate limiting
    const now = Date.now();
    
    // Reset counter after time window
    if (now - lastAuthErrorTime > AUTH_ERROR_RESET_TIME) {
      globalAuthErrorCount = 0;
    }
    
    // Update tracking
    lastAuthErrorTime = now;
    globalAuthErrorCount++;
    
    // Log the error
    console.warn(`Auth error detected from ${source} (count: ${globalAuthErrorCount})`);
    
    // Skip if already refreshing or too soon
    if (isTokenRefreshing || !canRefresh()) {
      console.log('Token already refreshing or cooldown active, skipping');
      return;
    }
    
    // Only show notification after multiple errors
    if (globalAuthErrorCount >= AUTH_ERROR_THRESHOLD) {
      toast.warning('Session refresh needed', {
        description: 'Refreshing authentication...',
        id: 'auth-refresh-toast',
        duration: 3000
      });
    }
    
    // Start refresh process
    try {
      setIsTokenRefreshing(true);
      lastRefreshRef.current = now;
      
      // Clear any existing timeout
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      
      // Add slight delay to prevent race conditions
      refreshTimeoutRef.current = setTimeout(async () => {
        try {
          // Try to get token directly from Clerk
          const token = await getToken({ 
            skipCache: true,
            expiration: 60 * 60 // Request 1 hour token
          });
          
          if (token) {
            // Success! Parse token to see actual expiration
            try {
              const parts = token.split('.');
              if (parts.length === 3) {
                const payload = JSON.parse(atob(parts[1]));
                if (payload.exp) {
                  const expiresAt = new Date(payload.exp * 1000);
                  console.log(`New token after auth error expires at: ${expiresAt.toISOString()}`);
                }
              }
            } catch (e) { /* Ignore parsing errors */ }
            
            // Show success toast if we showed error before
            if (globalAuthErrorCount >= AUTH_ERROR_THRESHOLD) {
              toast.success('Session refreshed', {
                id: 'auth-refresh-toast',
                duration: 2000
              });
            }
            
            // Reset error count
            globalAuthErrorCount = 0;
          }
        } catch (refreshError) {
          console.error('Failed to refresh token after auth error:', refreshError);
          
          // Try API refresh as fallback
          try {
            await refreshToken(true);
            
            if (globalAuthErrorCount >= AUTH_ERROR_THRESHOLD) {
              toast.success('Session refreshed', {
                id: 'auth-refresh-toast',
                duration: 2000
              });
            }
            
            // Reset error count
            globalAuthErrorCount = 0;
          } catch (apiRefreshError) {
            console.error('API refresh also failed:', apiRefreshError);
            
            if (globalAuthErrorCount >= AUTH_ERROR_THRESHOLD) {
              toast.error('Failed to refresh session', {
                description: 'Try reloading the page',
                duration: 5000
              });
            }
          }
        } finally {
          setIsTokenRefreshing(false);
          refreshTimeoutRef.current = null;
        }
      }, 300);
    } catch (error) {
      console.error('Error starting auth error handling:', error);
      setIsTokenRefreshing(false);
    }
  };
  
  // Set up listeners for auth errors
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
    
    // Listen for auth error events
    window.addEventListener('api-auth-error', handleApiAuthError);
    
    // Set up global reporter function
    window.reportAuthError = (source) => {
      handleAuthError(source || 'manual');
      
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