import { Routes, Route } from 'react-router-dom'
import { 
  SignedIn, 
  SignedOut, 
  SignIn, 
  SignUp, 
  ClerkLoaded, 
  ClerkLoading, 
  RedirectToSignIn,
  useUser 
} from '@clerk/clerk-react'
import { useState, useEffect } from 'react'
import Layout from './components/Layout'
import DocumentTranslationPage from './components/DocumentTranslation'
import AccountSettings from './components/AccountSettingsPage'
import TranslationHistoryPage from './components/TranslationHistoryPage'
import TranslationView from './components/TranslationView'
import TokenKeepalive from './components/TokenKeepalive'
import TokenStatusMonitor from './components/TokenStatusMonitor'

// Consolidated Token Management Component
function TokenManagement() {
  const { isSignedIn } = useUser();
  const [shouldManageToken, setShouldManageToken] = useState(false);

  useEffect(() => {
    // Only enable token management after a short delay
    // This prevents immediate token-related requests on page load
    const timer = setTimeout(() => {
      setShouldManageToken(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, [isSignedIn]);

  if (!isSignedIn || !shouldManageToken) return null;

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
        {/* Consolidated and delayed token management */}
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