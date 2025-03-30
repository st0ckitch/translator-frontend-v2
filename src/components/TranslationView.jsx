import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, FileText, Download, Languages, Copy, Check } from 'lucide-react';
import { useApiAuth } from '../services/api';
import { toast } from 'sonner';
import DocumentDownloadButton from './DocumentDownloadButton';

export default function TranslationView() {
  const { processId } = useParams();
  const navigate = useNavigate();
  const [translationData, setTranslationData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCopied, setIsCopied] = useState(false);
  const { registerAuthInterceptor } = useApiAuth();

  // Register auth interceptor on mount and load data
  useEffect(() => {
    registerAuthInterceptor();
    
    // Try to load from sessionStorage first (faster)
    const cachedData = sessionStorage.getItem('viewTranslation');
    if (cachedData) {
      try {
        const parsedData = JSON.parse(cachedData);
        if (parsedData.processId === processId) {
          setTranslationData(parsedData);
          setLoading(false);
          return;
        }
      } catch (err) {
        console.error('Failed to parse cached translation data:', err);
      }
    }
    
    // Fallback to fetching from API
    fetchTranslationContent();
  }, [processId]);

  // Fetch full translation content
  const fetchTranslationContent = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/history/history/${processId}/content`);
      
      if (!response.ok) {
        throw new Error(`Error fetching translation: ${response.statusText}`);
      }
      
      const data = await response.json();
      setTranslationData(data);
      
      // Cache in sessionStorage for future use
      sessionStorage.setItem('viewTranslation', JSON.stringify(data));
    } catch (err) {
      console.error('Failed to fetch translation content:', err);
      setError('Failed to load translation content. Please try again later.');
      toast.error('Failed to load translation content');
    } finally {
      setLoading(false);
    }
  };

  // Copy content to clipboard
  const handleCopyText = async () => {
    if (!translationData?.combinedContent) return;
    
    try {
      await navigator.clipboard.writeText(
        // Strip HTML tags for plain text copy
        translationData.combinedContent.replace(/<[^>]*>/g, '')
      );
      
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      toast.success('Text copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy text:', err);
      toast.error('Failed to copy text to clipboard');
    }
  };

  // Format the date for display
  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown date';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  // Get the language name from its code
  const getLanguageName = (code) => {
    const languages = {
      'en': 'English',
      'ka': 'Georgian',
      'tr': 'Turkish',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ru': 'Russian',
      'zh': 'Chinese',
      'ja': 'Japanese',
      'ko': 'Korean',
      'ar': 'Arabic',
      'hi': 'Hindi',
      'fa': 'Persian',
    };
    
    return languages[code] || code;
  };

  return (
    <div className="py-8 px-4 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center mb-6">
          <button
            onClick={() => navigate('/history')}
            className="mr-4 p-2 rounded-full hover:bg-gray-200 text-gray-600"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
          
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              {loading ? 'Loading Translation...' : (
                translationData?.metadata?.fileName || 'Translation View'
              )}
            </h1>
            <p className="text-gray-600 text-sm">
              From your translation history
            </p>
          </div>
        </div>
        
        {/* Main content */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="flex flex-col items-center">
              <Loader2 className="w-10 h-10 animate-spin text-indigo-600 mb-4" />
              <p className="text-gray-600">Loading translation content...</p>
            </div>
          </div>
        ) : error ? (
          <div className="bg-red-50 p-6 rounded-lg text-red-600">
            <h3 className="text-lg font-medium mb-2">Error</h3>
            <p>{error}</p>
            <button 
              onClick={fetchTranslationContent}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              Try Again
            </button>
          </div>
        ) : (
          <>
            {/* Document details card */}
            <div className="bg-white rounded-xl shadow-md overflow-hidden mb-6 border border-gray-200">
              <div className="px-6 py-4 bg-gradient-to-r from-indigo-600 to-indigo-800">
                <h2 className="text-lg font-semibold text-white flex items-center">
                  <FileText className="mr-2 h-5 w-5" />
                  Document Information
                </h2>
              </div>
              
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">File Name</p>
                    <p className="font-medium">{translationData.metadata?.fileName || 'Unnamed Document'}</p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-gray-500">Translation</p>
                    <p className="font-medium flex items-center">
                      {getLanguageName(translationData.metadata?.fromLang)} 
                      <ArrowLeft className="mx-2 h-3 w-3 transform rotate-180" /> 
                      {getLanguageName(translationData.metadata?.toLang)}
                    </p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-gray-500">Pages</p>
                    <p className="font-medium">{translationData.metadata?.totalPages || 0}</p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-gray-500">Completed</p>
                    <p className="font-medium">{formatDate(translationData.metadata?.completedAt)}</p>
                  </div>
                </div>
                
                <div className="flex justify-end mt-4 gap-2">
                  <button
                    onClick={handleCopyText}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors"
                  >
                    {isCopied ? <Check size={16} /> : <Copy size={16} />}
                    {isCopied ? "Copied" : "Copy Text"}
                  </button>
                  
                  <DocumentDownloadButton
                    text={translationData.combinedContent}
                    language={translationData.metadata?.toLang || "en"}
                    onError={(error) => toast.error(error)}
                    onSuccess={() => toast.success('Document downloaded successfully!')}
                    className="flex items-center gap-2"
                  />
                </div>
              </div>
            </div>
            
            {/* Translated content */}
            <div className="bg-white rounded-xl shadow-md overflow-hidden border border-gray-200">
              <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center">
                  <Languages className="mr-2 h-5 w-5 text-indigo-600" />
                  Translated Content
                </h2>
              </div>
              
              <div
                className="document-preview p-6 overflow-auto"
                style={{
                  direction: translationData.metadata?.direction || 'ltr',
                  textAlign: translationData.metadata?.direction === 'rtl' ? 'right' : 'left',
                  fontFamily: translationData.metadata?.direction === 'rtl' ? 'Tahoma, Arial' : 'inherit',
                }}
                dangerouslySetInnerHTML={{ __html: translationData.combinedContent }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}