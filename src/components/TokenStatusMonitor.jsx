// src/components/TokenStatusMonitor.jsx - Component to monitor token status and handle auth errors
import { useEffect, useRef, useState } from 'react';
import { useApiAuth } from '../services/api';
import api from '../services/api'; // Import default api
import { toast } from 'sonner';

// Create a global auth error handler
let globalAuthErrorCount = 0;
let lastAuthErrorTime = 0;
const AUTH_ERROR_THRESHOLD = 2; // Number of auth errors before showing notification
const AUTH_ERROR_RESET_TIME = 30000; // 30 seconds - time to reset error count

// Create a simple function to invalidate cache
const invalidateCache = () => {
  console.log('📦 Balance cache invalidated');
  // In the actual implementation, this would interact with a cache mechanism
};

export default function TokenStatusMonitor() {
  const { refreshToken } = useApiAuth();
  const [isTokenRefreshing, setIsTokenRefreshing] = useState(false);
  const refreshTimeoutRef = useRef(null);
  
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
    if (isTokenRefreshing) {
      console.log('Token already refreshing, skipping duplicate refresh');
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
            
            // Invalidate balance cache after successful refresh
            invalidateCache();
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
    
    // Create local document service with modified methods
    const documentService = {
      // Create a placeholder for checkTranslationStatus function
      checkTranslationStatus: async (processId) => {
        try {
          // Use direct API call instead
          const response = await api.get(`/documents/status/${processId}`);
          return response.data;
        } catch (error) {
          // Check for auth errors
          if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            // Report the auth error
            window.reportAuthError('checkTranslationStatus');
            
            // Return fallback status
            return {
              processId: processId,
              status: 'pending',
              progress: 0,
              currentPage: 0, 
              totalPages: 0,
              isFallback: true,
              timestamp: Date.now()
            };
          }
          throw error;
        }
      },
      
      // Original method to be patched
      _createFallbackStatus: (processId) => {
        // Fallback status for when the actual status cannot be fetched
        return {
          processId: processId,
          status: 'pending',
          progress: 0,
          currentPage: 0,
          totalPages: 0,
          isFallback: true,
          timestamp: Date.now()
        };
      }
    };
    
    // Patch document service methods to automatically handle auth errors
    const originalCheckTranslationStatus = documentService.checkTranslationStatus;
    
    // This would normally patch the global documentService object,
    // but since we're recreating it locally, this is just for reference
    if (window.patchDocumentService) {
      window.patchDocumentService(documentService);
    }
    
    return () => {
      // Clean up listeners
      window.removeEventListener('api-auth-error', handleApiAuthError);
      
      // Restore original methods - again, this is just for reference
      if (window.restoreDocumentService) {
        window.restoreDocumentService();
      }
      
      // Clear timeout
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [handleAuthError]);
  
  // This component doesn't render anything visible
  return null;
}