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

// Custom token cache to reduce unnecessary requests
const tokenCache = {
  cache: new Map(),
  get(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiry) {
      return cached.token;
    }
    this.cache.delete(key);
    return null;
  },
  set(key, token, ttl = 5 * 60 * 1000) {
    this.cache.set(key, {
      token,
      expiry: Date.now() + ttl
    });
  }
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ClerkProvider 
        publishableKey={clerkPubKey}
        options={{
          afterSignInUrl: '/',
          afterSignUpUrl: '/',
          // Experimental options to reduce requests
          __internal__experimental: {
            // Disable automatic version checks
            disableVersionCheck: true,
            // Reduce token refresh frequency
            tokenRefreshInterval: 10 * 60 * 1000, // 10 minutes
          },
          // Custom token caching
          tokenCache: {
            // Override default caching with our custom implementation
            getCached: (key) => tokenCache.get(key),
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