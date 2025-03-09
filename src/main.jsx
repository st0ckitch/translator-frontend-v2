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

const tokenCache = {
  cache: new Map(),
  debugMode: false, // Set to true to log cache operations
  
  // Parse JWT to get expiration time
  _getTokenExpiry(token) {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        if (payload.exp) {
          // Convert to milliseconds and subtract 3 minutes for safety
          return (payload.exp * 1000) - (3 * 60 * 1000);
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  },
  
  // Get token from cache
  get(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiry) {
      if (this.debugMode) console.log(`Cache hit for ${key}, expires in ${Math.round((cached.expiry - Date.now())/1000)}s`);
      return cached.token;
    }
    
    if (this.debugMode) console.log(`Cache miss for ${key}`);
    this.cache.delete(key);
    return null;
  },
  
  // Store token in cache with smart expiration
  set(key, token, ttl = 45 * 60 * 1000) { // 45 minute default
    // Try to extract actual expiration from token
    const tokenExpiry = this._getTokenExpiry(token);
    const now = Date.now();
    
    // Use the token's expiration time if available, otherwise use TTL
    const expiry = tokenExpiry ? Math.min(now + ttl, tokenExpiry) : now + ttl;
    
    if (this.debugMode) {
      console.log(`Caching token ${key.substring(0, 10)}... for ${Math.round((expiry - now)/1000)}s`);
      if (tokenExpiry) console.log(`Token's actual expiry detected: ${new Date(tokenExpiry).toISOString()}`);
    }
    
    // Store with calculated expiry
    this.cache.set(key, {
      token,
      expiry: expiry
    });
  }
};

// ClerkProvider with optimized settings
// In the ReactDOM.createRoot render section, replace the ClerkProvider with:

<ClerkProvider 
  publishableKey={clerkPubKey}
  options={{
    afterSignInUrl: '/',
    afterSignUpUrl: '/',
    // Experimental options to reduce requests
    __internal__experimental: {
      // Disable automatic version checks
      disableVersionCheck: true,
      // Greatly reduce token refresh frequency
      tokenRefreshInterval: 45 * 60 * 1000, // 45 minutes
    },
    // Custom token caching
    tokenCache: {
      // Override default caching with our enhanced implementation
      getCached: (key) => tokenCache.get(key),
      setCached: (key, token, ttl) => tokenCache.set(key, token, ttl || 45 * 60 * 1000)
    }
  }}
>
  <Toaster position="top-right" richColors closeButton />
  <App />
</ClerkProvider>