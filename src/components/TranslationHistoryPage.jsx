import { useState, useEffect } from 'react';
import { useUser } from '@clerk/clerk-react';
import { Clock, ChartBar, FileText, Loader2 } from 'lucide-react';
import TranslationHistory from './TranslationHistory';

export default function TranslationHistoryPage() {
  const { user, isLoaded } = useUser();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch translation statistics when component mounts
  useEffect(() => {
    if (isLoaded && user) {
      fetchTranslationStats();
    }
  }, [isLoaded, user]);

  // Function to fetch user's translation statistics
  const fetchTranslationStats = async () => {
    setLoading(true);
    
    try {
      // This endpoint doesn't exist yet, but we can implement it later
      // For now, we'll use placeholder data
      
      // Simulate an API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Placeholder stats
      setStats({
        totalTranslations: 5,
        totalPages: 14,
        mostRecentDate: new Date().toISOString()
      });
    } catch (err) {
      console.error('Failed to fetch translation stats:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="py-12 px-4 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        {/* Header Section */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4">
            <Clock className="h-16 w-16 text-indigo-600" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-2 text-center bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-transparent">
            Translation History
          </h1>
          <p className="text-lg text-gray-600 text-center max-w-2xl">
            View and manage your previous translations
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {loading ? (
            <div className="col-span-3 flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          ) : (
            <>
              <div className="bg-white rounded-xl shadow-md p-6 border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-700">Total Translations</h3>
                  <div className="p-2 bg-blue-100 rounded-full">
                    <FileText className="h-5 w-5 text-blue-600" />
                  </div>
                </div>
                <p className="text-3xl font-bold text-blue-600">{stats?.totalTranslations || 0}</p>
                <p className="text-sm text-gray-500 mt-1">Documents translated</p>
              </div>
              
              <div className="bg-white rounded-xl shadow-md p-6 border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-700">Total Pages</h3>
                  <div className="p-2 bg-green-100 rounded-full">
                    <ChartBar className="h-5 w-5 text-green-600" />
                  </div>
                </div>
                <p className="text-3xl font-bold text-green-600">{stats?.totalPages || 0}</p>
                <p className="text-sm text-gray-500 mt-1">Pages processed</p>
              </div>
              
              <div className="bg-white rounded-xl shadow-md p-6 border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-700">Latest Translation</h3>
                  <div className="p-2 bg-purple-100 rounded-full">
                    <Clock className="h-5 w-5 text-purple-600" />
                  </div>
                </div>
                <p className="text-lg font-medium text-purple-600">
                  {stats?.mostRecentDate
                    ? new Date(stats.mostRecentDate).toLocaleDateString()
                    : 'Never'}
                </p>
                <p className="text-sm text-gray-500 mt-1">Last completed translation</p>
              </div>
            </>
          )}
        </div>

        {/* Translation History Component */}
        <TranslationHistory />
      </div>
    </div>
  );
}