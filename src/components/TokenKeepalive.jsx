// src/components/TokenKeepalive.jsx - A component to maintain token freshness during idle periods
import { useEffect, useRef, useState } from 'react';
import { useApiAuth } from '../services/api';
import { useUser } from '@clerk/clerk-react';

const TOKEN_REFRESH_INTERVAL = 4 * 60 * 1000; // 4 minutes
const INACTIVITY_CHECK_INTERVAL = 60 * 1000; // 1 minute

export default function TokenKeepalive() {
  const { isSignedIn } = useUser();
  const { refreshToken, getTokenDiagnostics } = useApiAuth();
  const refreshIntervalRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const checkActivityIntervalRef = useRef(null);
  const [debugInfo, setDebugInfo] = useState(null);
  
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
        // Check current token status
        const tokenInfo = await getTokenDiagnostics();
        setDebugInfo(tokenInfo); // Store for debugging
        
        // Calculate inactive time
        const inactiveTime = Date.now() - lastActivityRef.current;
        const inactiveMinutes = Math.round(inactiveTime / 60000);
        
        // If token is expiring soon (less than 10 minutes) or user has been inactive
        // for more than 5 minutes, refresh the token
        if (
          (tokenInfo.currentToken?.remainingMinutes < 10) || 
          (inactiveMinutes >= 5)
        ) {
          console.log(`🔄 Refreshing token: ${
            tokenInfo.currentToken?.remainingMinutes < 10 
              ? 'Token expiring soon' 
              : 'User inactive'
          }`);
          
          // Refresh token to maintain session
          await refreshToken(true);
          
          // Update debug info after refresh
          const updatedInfo = await getTokenDiagnostics();
          setDebugInfo(updatedInfo);
          
          console.log(`✅ Token refreshed, now valid for ${updatedInfo.currentToken?.remainingMinutes} minutes`);
        }
      } catch (error) {
        console.error('Failed to check or refresh token:', error);
      }
    };
    
    // Setup interval to check activity and refresh token
    checkActivityIntervalRef.current = setInterval(() => {
      checkAndRefreshToken();
    }, TOKEN_REFRESH_INTERVAL);
    
    // Initial check
    checkAndRefreshToken();
    
    return () => {
      if (checkActivityIntervalRef.current) {
        clearInterval(checkActivityIntervalRef.current);
      }
    };
  }, [isSignedIn, refreshToken, getTokenDiagnostics]);
  
  // This component doesn't render anything
  return null;
}