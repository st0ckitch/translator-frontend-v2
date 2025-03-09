import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClerkProvider } from '@clerk/clerk-react'
import { Toaster } from 'sonner'
import App from './App.jsx'
import './index.css'

// Add COOP header for the main application
if (typeof window !== 'undefined') {
  const metaTag = document.createElement('meta');
  metaTag.httpEquiv = 'Cross-Origin-Opener-Policy';
  metaTag.content = 'same-origin-allow-popups';
  document.head.appendChild(metaTag);
}

// Get Clerk publishable key from environment variables
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Enhanced token cache that handles short-lived tokens
const tokenCache = {
  cache: new Map(),
  lastRefreshAttempt: 0,
  minRefreshInterval: 45 * 1000, // 45 seconds minimum between refreshes
  
  get(key) {
    const cached = this.cache.get(key);
    if (cached) {
      // Always return cached token unless explicitly expired
      const now = Date.now();
      if (now < cached.expiry) {
        return cached.token;
      }
      // If expired, remove from cache
      this.cache.delete(key);
    }
    return null;
  },
  
  set(key, token, ttl = 55 * 1000) { // Default 55 seconds (for 1 minute tokens)
    try {
      // Try to extract actual expiration from token
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        if (payload.exp) {
          // Set expiry 5 seconds before actual expiration
          const expiry = (payload.exp * 1000) - 5000;
          this.cache.set(key, { token, expiry });
          window.__tokenExpiresAt = expiry;
          return;
        }
      }
    } catch (e) {
      console.warn('Error parsing token:', e);
    }
    
    // Fallback if can't parse token
    this.cache.set(key, { 
      token, 
      expiry: Date.now() + ttl 
    });
    window.__tokenExpiresAt = Date.now() + ttl;
  },
  
  // Control request frequency
  canRequestNewToken() {
    const now = Date.now();
    const timeSinceLastAttempt = now - this.lastRefreshAttempt;
    if (timeSinceLastAttempt < this.minRefreshInterval) {
      return false;
    }
    this.lastRefreshAttempt = now;
    return true;
  }
};

// Add request throttling to prevent excessive token requests
if (typeof window !== 'undefined') {
  // Track the last request time
  window.__lastTokenRequest = 0;
  window.__pendingRequests = new Set();
  
  // Original fetch
  const originalFetch = window.fetch;
  
  // Replace fetch to throttle requests
  window.fetch = function(...args) {
    const url = args[0].toString();
    
    // If this is a token request
    if (url.includes('tokens?_clerk_js_version')) {
      const now = Date.now();
      const timeSinceLastRequest = now - window.__lastTokenRequest;
      
      // Check if this URL is already being fetched
      if (window.__pendingRequests.has(url)) {
        console.log('Duplicate request prevented:', url);
        return new Promise(resolve => {
          // Wait for the original request to complete
          const checkComplete = setInterval(() => {
            if (!window.__pendingRequests.has(url)) {
              clearInterval(checkComplete);
              // Return a simple mock response
              resolve(new Response(JSON.stringify({ cached: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              }));
            }
          }, 100);
        });
      }
      
      // Rate limit if too frequent
      if (timeSinceLastRequest < 500) { // 500ms
        console.log('Rate limiting Clerk request');
        return new Promise(resolve => {
          setTimeout(() => {
            resolve(originalFetch.apply(this, args));
          }, 1000);
        });
      }
      
      // Track this request
      window.__lastTokenRequest = now;
      window.__pendingRequests.add(url);
      
      // Original fetch with cleanup
      return originalFetch.apply(this, args).finally(() => {
        window.__pendingRequests.delete(url);
      });
    }
    
    // Regular fetch for non-token requests
    return originalFetch.apply(this, args);
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ClerkProvider 
        publishableKey={clerkPubKey}
        options={{
          afterSignInUrl: '/',
          afterSignUpUrl: '/',
          __internal__experimental: {
            // Disable automatic version checks
            disableVersionCheck: true,
            // Request longer-lived tokens (may not be honored by Clerk)
            tokenRefreshInterval: 50 * 1000, // Request refresh slightly before token expiry
          },
          // Custom token caching
          tokenCache: {
            getCached: (key) => {
              // Check if we can request a new token
              if (!tokenCache.canRequestNewToken()) {
                const cached = tokenCache.cache.get(key);
                if (cached) {
                  console.log('Force using cached token due to rate limiting');
                  return cached.token;
                }
              }
              return tokenCache.get(key);
            },
            setCached: (key, token, ttl) => tokenCache.set(key, token, ttl)
          }
        }}
      >
        <Toaster position="top-right" richColors closeButton />
        <App />
      </ClerkProvider>
    </BrowserRouter>
  </React.StrictMode>,
)