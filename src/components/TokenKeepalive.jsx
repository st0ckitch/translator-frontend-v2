// src/components/TokenKeepalive.jsx - Optimized token management
import { useEffect, useRef, useState } from 'react';
import { useApiAuth } from '../services/api';
import { useUser } from '@clerk/clerk-react';

const TOKEN_REFRESH_INTERVAL = 30 * 1000; // 30 seconds
const INACTIVITY_THRESHOLD = 5 * 60 * 1000; // 5 minutes

export default function TokenKeepalive() {
  const { isSignedIn } = useUser();
  const { refreshToken, getTokenDiagnostics } = useApiAuth();
  const refreshIntervalRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const lastRefreshRef = useRef(0);
  const [debugInfo, setDebugInfo] = useState(null);
  
  // Prevent rapid, concurrent refreshes
  const canRefresh = () => {
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshRef.current;
    
    // Enforce minimum time between refreshes
    return timeSinceLastRefresh > 30000; // 30 seconds
  };

  // Update last activity timestamp on user interaction
  useEffect(() => {
    const updateLastActivity = () => {
      lastActivityRef.current = Date.now();
    };
    
    // Add event listeners for user activity
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];
    events.forEach(event => {
      window.addEventListener(event, updateLastActivity, { passive: true });
    });
    
    return () => {
      // Remove event listeners on cleanup
      events.forEach(event => {
        window.removeEventListener(event, updateLastActivity);
      });
    };
  }, []);
  
  // Setup token refresh during inactivity
  useEffect(() => {
    if (!isSignedIn) return;
    
    // Function to check token and refresh if needed
    const checkAndRefreshToken = async () => {
      try {
        // Check if we can refresh
        if (!canRefresh()) {
          console.log('🛑 Skipping token refresh - too soon since last refresh');
          return;
        }

        // Check current token status
        const tokenInfo = await getTokenDiagnostics();
        setDebugInfo(tokenInfo); // Store for debugging
        
        // Calculate inactive time
        const inactiveTime = Date.now() - lastActivityRef.current;
        
        // More conservative refresh conditions
        const shouldRefresh = 
          // Token is about to expire
          (tokenInfo.currentToken?.remainingMinutes < 1) ||
          // Long period of inactivity
          (inactiveTime > INACTIVITY_THRESHOLD);
        
        if (shouldRefresh) {
          console.log(`🔄 Refreshing token: ${
            tokenInfo.currentToken?.remainingMinutes < 1 
              ? 'Token expiring soon' 
              : 'User inactive'
          }`);
          
          // Update last refresh timestamp
          lastRefreshRef.current = Date.now();
          
          // Refresh token
          const newToken = await refreshToken(true);
          
          if (newToken) {
            // Update debug info after refresh
            const updatedInfo = await getTokenDiagnostics();
            setDebugInfo(updatedInfo);
            
            console.log(`✅ Token refreshed, now valid for ${updatedInfo.currentToken?.remainingMinutes} minutes`);
          }
        }
      } catch (error) {
        console.error('Failed to check or refresh token:', error);
      }
    };
    
    // Setup interval to check activity and refresh token
    refreshIntervalRef.current = setInterval(checkAndRefreshToken, TOKEN_REFRESH_INTERVAL);
    
    // Initial check
    checkAndRefreshToken();
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [isSignedIn, refreshToken, getTokenDiagnostics]);
  
  // This component doesn't render anything
  return null;
}