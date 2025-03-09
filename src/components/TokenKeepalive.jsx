import { useEffect } from 'react';

export default function TokenKeepalive() {
  // This component is completely disabled
  useEffect(() => {
    console.log('TokenKeepalive is disabled to prevent excessive token requests');
  }, []);
  
  // No UI, no token management
  return null;
}
