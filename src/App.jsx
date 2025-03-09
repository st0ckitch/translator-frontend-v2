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

  // Manual initial token fetch to avoid multiple components requesting tokens
  useEffect(() => {
    if (isSignedIn && !initRef.current) {
      initRef.current = true;
      
      // Wait 3 seconds after app load before doing anything
      const timer = setTimeout(async () => {
        try {
          // Fetch a token with 1 hour expiration request
          const token = await getToken({ expiration: 60 * 60 });
          if (token) {
            console.log('Initial token fetched successfully');
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
                    20000 // At least 20 seconds later
                  );
                  // Schedule token management to start shortly before token expires
                  setTimeout(() => {
                    console.log('Enabling token management components');
                    setTokenComponentsEnabled(true);
                  }, timeUntilRefresh);
                  return;
                }
              }
            } catch (e) {
              console.warn('Error parsing token:', e);
            }
          }
        } catch (e) {
          console.error('Error fetching initial token:', e);
        }
        
        // If we failed to get a token or parse it, enable after 30 seconds
        setTimeout(() => {
          console.log('Enabling token management as fallback');
          setTokenComponentsEnabled(true);
        }, 30000);
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [isSignedIn, getToken]);
  
  // Only render actual token management when explicitly enabled
  // and after initial delay to prevent startup congestion
  if (!isSignedIn || !tokenComponentsEnabled) return null;
  
  return (
    <>
      <TokenKeepalive />
      <TokenStatusMonitor />
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
            <Route path="/history" element={
              <>
                <SignedIn>
                  <TranslationHistoryPage />
                </SignedIn>
                <SignedOut>
                  <RedirectToSignIn />
                </SignedOut>
              </>
            } />
            
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