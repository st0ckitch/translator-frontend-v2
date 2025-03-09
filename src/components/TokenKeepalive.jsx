// src/components/TokenKeepalive.jsx - Optimized token management
import { useEffect, useRef, useState } from 'react';
import { useApiAuth } from '../services/api';
import { useUser } from '@clerk/clerk-react';

// Significantly reduced refresh frequency
const TOKEN_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const INACTIVITY_THRESHOLD = 15 * 60 * 1000; // 15 minutes
const MIN_REFRESH_INTERVAL = 2 * 60 * 1000; // 2 minutes minimum between refreshes

export default function TokenKeepalive() {
  const { isSignedIn } = useUser();
  const { refreshToken, getTokenDiagnostics } = useApiAuth();
  const refreshIntervalRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const lastRefreshRef = useRef(0);
  const throttleTimerRef = useRef(null);
  
  // Rate limiting for token refreshes
  const canRefresh = () => {
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshRef.current;
    return timeSinceLastRefresh > MIN_REFRESH_INTERVAL;
  };

  // Update last activity timestamp with aggressive throttling
  useEffect(() => {
    let lastUpdateTime = 0;
    const THROTTLE_TIME = 30000; // Only update every 30 seconds max
    
    const updateLastActivity = () => {
      const now = Date.now();
      if (now - lastUpdateTime > THROTTLE_TIME) {
        lastActivityRef.current = now;
        lastUpdateTime = now;
        
        // Clear any pending throttle timer
        if (throttleTimerRef.current) {
          clearTimeout(throttleTimerRef.current);
        }
        
        // Set a debounce timer
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
        }, THROTTLE_TIME);
      }
    };
    
    // Minimal event listeners using passive option for performance
    const events = ['mousedown', 'keydown'];
    events.forEach(event => {
      window.addEventListener(event, updateLastActivity, { passive: true });
    });
    
    return () => {
      events.forEach(event => {
        window.removeEventListener(event, updateLastActivity);
      });
      
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);
  
  // Token refresh logic with reduced frequency
  useEffect(() => {
    if (!isSignedIn) return;
    
    const checkAndRefreshToken = async () => {
      try {
        // Skip if we've refreshed recently
        if (!canRefresh()) {
          return;
        }

        // Check token status
        const tokenInfo = await getTokenDiagnostics();
        
        // Calculate inactive time
        const inactiveTime = Date.now() - lastActivityRef.current;
        
        // Very conservative refresh conditions - only refresh when:
        // 1. Token is about to expire (less than 3 minutes remaining)
        // 2. User has been inactive for a long time AND token has less than 20 minutes left
        const shouldRefresh = 
          (tokenInfo.currentToken?.remainingMinutes < 3) || 
          (inactiveTime > INACTIVITY_THRESHOLD && tokenInfo.currentToken?.remainingMinutes < 20);
        
        if (shouldRefresh) {
          console.log(`Token refresh triggered: ${
            tokenInfo.currentToken?.remainingMinutes < 3 
              ? 'Token expiring soon' 
              : 'Extended user inactivity'
          }`);
          
          // Update last refresh timestamp and refresh token
          lastRefreshRef.current = Date.now();
          await refreshToken(true);
        }
      } catch (error) {
        console.error('Token refresh check failed:', error);
      }
    };
    
    // Initial check with a significant delay to avoid app startup congestion
    const initialTimer = setTimeout(() => {
      checkAndRefreshToken();
    }, 10000);
    
    // Setup interval with much less frequent checks
    refreshIntervalRef.current = setInterval(checkAndRefreshToken, TOKEN_REFRESH_INTERVAL);
    
    return () => {
      clearTimeout(initialTimer);
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [isSignedIn, refreshToken, getTokenDiagnostics]);
  
  // No visible UI
  return null;
}