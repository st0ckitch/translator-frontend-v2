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

// Simple token cache with very long expiration
const tokenCache = {
  cache: new Map(),
  
  // Get token from cache, always return it if it exists
  get(key) {
    const cached = this.cache.get(key);
    if (cached) {
      console.log(`Using cached token for ${key}`);
      return cached.token;
    }
    return null;
  },
  
  // Store token with no expiration check
  set(key, token) {
    console.log(`Caching token for ${key}`);
    this.cache.set(key, {
      token,
      timestamp: Date.now()
    });
  }
};

// Intercept fetch requests to prevent excessive token requests
if (typeof window !== 'undefined') {
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const url = args[0].toString();
    
    // Block excessive token requests
    if (url.includes('tokens?_clerk_js_version')) {
      const now = Date.now();
      if (!window.__lastClerkTokenRequest) {
        window.__lastClerkTokenRequest = now;
      } else if (now - window.__lastClerkTokenRequest < 5000) { // 5 seconds
        console.log(`Blocking redundant clerk token request`);
        // Return mock response
        return Promise.resolve(new Response(JSON.stringify({
          jwt: "cached_token_placeholder"
        }), { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      window.__lastClerkTokenRequest = now;
    }
    
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
            // Disable all automatic checks
            disableVersionCheck: true,
            disableDevCdnEndpoint: true,
            // Maximum interval
            tokenRefreshInterval: 24 * 60 * 60 * 1000, // 24 hours
          },
          // Custom token caching
          tokenCache: {
            getCached: (key) => tokenCache.get(key),
            setCached: (key, token) => tokenCache.set(key, token)
          }
        }}
      >
        <Toaster position="top-right" richColors closeButton />
        <App />
      </ClerkProvider>
    </BrowserRouter>
  </React.StrictMode>,
)