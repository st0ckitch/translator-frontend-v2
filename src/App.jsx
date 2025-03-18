import { Routes, Route } from 'react-router-dom'
import { 
  SignedIn, 
  SignedOut, 
  SignIn, 
  SignUp, 
  ClerkLoaded, 
  ClerkLoading, 
  RedirectToSignIn,
  useUser,
  useAuth
} from '@clerk/clerk-react'
import { useState, useEffect, useRef } from 'react'
import Layout from './components/Layout'
import DocumentTranslationPage from './components/DocumentTranslation'
import AccountSettings from './components/AccountSettingsPage'
import TranslationHistoryPage from './components/TranslationHistoryPage'
import TranslationView from './components/TranslationView'
import TokenKeepalive from './components/TokenKeepalive'
import TokenStatusMonitor from './components/TokenStatusMonitor'

// Optimized Token Management Component with rate limiting
function TokenManagement() {
  const { isSignedIn } = useUser();
  const { getToken } = useAuth();
  const initRef = useRef(false);
  const [tokenComponentsEnabled, setTokenComponentsEnabled] = useState(false);
  const lastTokenCheckRef = useRef(0);
  const [initialTokenFetched, setInitialTokenFetched] = useState(false);

  // Make the initial token fetch available globally for components that need it
  useEffect(() => {
    if (!window.hasOwnProperty('__initialTokenPromise')) {
      window.__initialTokenPromise = null;
    }
  }, []);

  // Manual initial token fetch to avoid multiple components requesting tokens
  useEffect(() => {
    if (isSignedIn && !initRef.current) {
      initRef.current = true;
      
      // Create a promise for the initial token fetch that other components can await
      if (!window.__initialTokenPromise) {
        window.__initialTokenPromise = (async () => {
          try {
            // Fetch a token with 1 hour expiration request immediately
            console.log('Fetching initial token...');
            const token = await getToken({ 
              skipCache: true,
              expiration: 60 * 60 
            });
            
            if (token) {
              console.log('Initial token fetched successfully');
              setInitialTokenFetched(true);
              
              // Parse the token to see actual expiration
              try {
                const parts = token.split('.');
                if (parts.length === 3) {
                  const payload = JSON.parse(atob(parts[1]));
                  if (payload.exp) {
                    const expiresAt = new Date(payload.exp * 1000);
                    console.log(`Token expires at: ${expiresAt.toISOString()}`);
                    
                    // Calculate time until we need to enable token management
                    const timeUntilRefresh = Math.max(
                      (payload.exp * 1000) - Date.now() - 10000, // 10 seconds before expiry
                      5000 // Start sooner (5 seconds) to prevent auth issues
                    );
                    
                    // Schedule token management to start shortly before token expires
                    setTimeout(() => {
                      console.log('Enabling token management components');
                      setTokenComponentsEnabled(true);
                    }, timeUntilRefresh);
                    
                    return token;
                  }
                }
              } catch (e) {
                console.warn('Error parsing token:', e);
              }
              
              return token;
            }
          } catch (e) {
            console.error('Error fetching initial token:', e);
          }
          
          // If we failed to get a token or parse it, enable management right away
          console.log('Enabling token management immediately due to fetch issues');
          setTokenComponentsEnabled(true);
          return null;
        })();
      }
      
      // Also set a fallback timer in case token fetching fails completely
      const fallbackTimer = setTimeout(() => {
        if (!initialTokenFetched) {
          console.log('Enabling token management as fallback (no token fetched)');
          setTokenComponentsEnabled(true);
        }
      }, 8000); // Shorter fallback time (8 seconds)
      
      return () => clearTimeout(fallbackTimer);
    }
  }, [isSignedIn, getToken, initialTokenFetched]);
  
  // Render token management components
  // Note: Now we render TokenStatusMonitor immediately for better error handling
  if (!isSignedIn) return null;
  
  return (
    <>
      <TokenStatusMonitor />
      {tokenComponentsEnabled && <TokenKeepalive />}
    </>
  );
}

function App() {
  return (
    <>
      <ClerkLoading>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      </ClerkLoading>
      
      <ClerkLoaded>
        {/* Optimized token management */}
        <SignedIn>
          <TokenManagement />
        </SignedIn>
        
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={
              <>
                <SignedIn>
                  <DocumentTranslationPage />
                </SignedIn>
                <SignedOut>
                  <RedirectToSignIn />
                </SignedOut>
              </>
            } />
            
            {/* Account Settings Route */}
            <Route path="/settings" element={
              <>
                <SignedIn>
                  <AccountSettings />
                </SignedIn>
                <SignedOut>
                  <RedirectToSignIn />
                </SignedOut>
              </>
            } />
            
            {/* Translation History Route */}
            {/* <Route path="/history" element={
              <>
                <SignedIn>
                  <TranslationHistoryPage />
                </SignedIn>
                <SignedOut>
                  <RedirectToSignIn />
                </SignedOut>
              </>
            } /> */}
            
            {/* Translation View Route */}
            <Route path="/view/:processId" element={
              <>
                <SignedIn>
                  <TranslationView />
                </SignedIn>
                <SignedOut>
                  <RedirectToSignIn />
                </SignedOut>
              </>
            } />
            
            {/* Sign In Route */}
            <Route path="/sign-in/*" element={
              <SignedOut>
                <div className="flex items-center justify-center min-h-[calc(100vh-8rem)] bg-gray-50">
                  <div className="w-full max-w-md">
                    <SignIn routing="path" path="/sign-in" />
                  </div>
                </div>
              </SignedOut>
            } />
            
            {/* Sign Up Route */}
            <Route path="/sign-up/*" element={
              <SignedOut>
                <div className="flex items-center justify-center min-h-[calc(100vh-8rem)] bg-gray-50">
                  <div className="w-full max-w-md">
                    <SignUp routing="path" path="/sign-up" />
                  </div>
                </div>
              </SignedOut>
            } />
          </Route>
        </Routes>
      </ClerkLoaded>
    </>
  )
}

export default App