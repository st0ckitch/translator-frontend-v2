import { useEffect } from 'react';

export default function TokenStatusMonitor() {
  // This component is completely disabled
  useEffect(() => {
    console.log('TokenStatusMonitor is disabled to prevent excessive token requests');
    
    // Setup a dummy global function to avoid errors
    if (typeof window !== 'undefined') {
      window.reportAuthError = () => {};
    }
  }, []);
  
  // No UI, no token management
  return null;
}