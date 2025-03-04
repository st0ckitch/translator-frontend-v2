import { useState, useEffect } from 'react';
import { Clock, FileText, ArrowRight, Loader2, RefreshCw, Eye, Download } from 'lucide-react';
import { useApiAuth } from '../services/api';
import { toast } from 'sonner';
import DocumentDownloadButton from './DocumentDownloadButton';
import { useNavigate } from 'react-router-dom';

export default function TranslationHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTranslation, setSelectedTranslation] = useState(null);
  const [previewContent, setPreviewContent] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const { registerAuthInterceptor } = useApiAuth();
  const navigate = useNavigate();

  // Register auth interceptor on mount
  useEffect(() => {
    registerAuthInterceptor();
    fetchHistory();
  }, []);

  // Function to fetch translation history
  const fetchHistory = async () => {
        setLoading(true);
        setError(null);
        
        try {
        // Check if the API endpoint is ready - if not, use mock data for now
        try {
            const response = await fetch('/api/history/history');
            
            if (!response.ok) {
            throw new Error(`Error fetching history: ${response.statusText}`);
            }
            
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
            throw new Error("API endpoint returned non-JSON response. Backend might not be ready.");
            }
            
            const data = await response.json();
            setHistory(data.history || []);
        } catch (apiError) {
            console.warn('API not ready, using mock data:', apiError);
            
            // Use mock data since the API isn't ready yet
            setTimeout(() => {
            setHistory([
                {
                processId: 'mock-id-1',
                fileName: 'Business Contract.pdf',
                fromLang: 'en',
                toLang: 'ru',
                status: 'completed',
                totalPages: 5,
                completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
                },
                {
                processId: 'mock-id-2',
                fileName: 'Travel Itinerary.pdf',
                fromLang: 'en',
                toLang: 'es',
                status: 'completed',
                totalPages: 2,
                completedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
                createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 3600000).toISOString()
                }
            ]);
            }, 1000); // Simulate an API delay
        }
        } catch (err) {
        console.error('Failed to fetch translation history:', err);
        setError('Failed to load translation history. Please try again later.');
        toast.error('Failed to load translation history');
        } finally {
        setLoading(false);
        }
    };

    // Function to fetch preview content for a translation
  const fetchPreview = async (processId) => {
        if (loadingPreview) return;
        
        setLoadingPreview(true);
        setPreviewContent(null);
        
        try {
        // Try to fetch from API, fallback to mock data if not ready
        try {
            const response = await fetch(`/api/history/history/${processId}/preview`);
            
            if (!response.ok) {
            throw new Error(`Error fetching preview: ${response.statusText}`);
            }
            
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
            throw new Error("API endpoint returned non-JSON response. Backend might not be ready.");
            }
            
            const data = await response.json();
            setPreviewContent(data);
        } catch (apiError) {
            console.warn('Preview API not ready, using mock data:', apiError);
            
            // Mock preview data based on the selected ID
            setTimeout(() => {
            setPreviewContent({
                processId: processId,
                preview: `<div class="document">
                <div class="page">
                    <h1>Sample Translated Document</h1>
                    <p>This is a sample of translated content. In a real application, this would be the actual translated content from your document.</p>
                    <p>The document would maintain its original formatting as much as possible, including:</p>
                    <ul>
                    <li>Headings and paragraphs</li>
                    <li>Lists and bullet points</li>
                    <li>Tables and other structured content</li>
                    </ul>
                    <p>The translation would preserve the document's layout while translating the text to your target language.</p>
                </div>
                </div>`,
                hasContent: true,
                totalChunks: 1,
                metadata: {
                fileName: processId === 'mock-id-1' ? 'Business Contract.pdf' : 'Travel Itinerary.pdf',
                fromLang: processId === 'mock-id-1' ? 'en' : 'en',
                toLang: processId === 'mock-id-1' ? 'ru' : 'es',
                totalPages: processId === 'mock-id-1' ? 5 : 2,
                completedAt: processId === 'mock-id-1' 
                    ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
                    : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
                }
            });
            }, 1000); // Simulate API delay
        }
        
        setSelectedTranslation(processId);
        } catch (err) {
        console.error('Failed to fetch translation preview:', err);
        toast.error('Failed to load translation preview');
        } finally {
        setLoadingPreview(false);
        }
    };

  // Function to view the full translation
  const viewFullTranslation = async (processId) => {
        try {
        // Try API first, fall back to mock data
        try {
            const response = await fetch(`/api/history/history/${processId}/content`);
            
            if (!response.ok) {
            throw new Error(`Error fetching content: ${response.statusText}`);
            }
            
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
            throw new Error("API endpoint returned non-JSON response. Backend might not be ready.");
            }
            
            const data = await response.json();
            sessionStorage.setItem('viewTranslation', JSON.stringify(data));
        } catch (apiError) {
            console.warn('Content API not ready, using mock data:', apiError);
            
            // Create mock full content
            const mockData = {
            processId: processId,
            chunks: [
                {
                pageNumber: 1,
                content: `<div class="page">
                    <h1>Full Translation Document</h1>
                    <p>This is page 1 of the mock translated document. This simulates the content you would see when viewing a full translation.</p>
                    <p>Real content would preserve the original document's formatting and layout.</p>
                </div>`
                },
                {
                pageNumber: 2,
                content: `<div class="page">
                    <h2>Page 2 Content</h2>
                    <p>This is the second page of the mock translated document.</p>
                    <p>In a real application, this would contain the actual translated content from your document.</p>
                </div>`
                }
            ],
            combinedContent: `<div class="document">
                <div class="page" id="page-1">
                <h1>Full Translation Document</h1>
                <p>This is page 1 of the mock translated document. This simulates the content you would see when viewing a full translation.</p>
                <p>Real content would preserve the original document's formatting and layout.</p>
                </div>
                <div class="page" id="page-2">
                <h2>Page 2 Content</h2>
                <p>This is the second page of the mock translated document.</p>
                <p>In a real application, this would contain the actual translated content from your document.</p>
                </div>
            </div>`,
            hasContent: true,
            metadata: {
                fileName: processId === 'mock-id-1' ? 'Business Contract.pdf' : 'Travel Itinerary.pdf',
                fromLang: processId === 'mock-id-1' ? 'en' : 'en',
                toLang: processId === 'mock-id-1' ? 'ru' : 'es',
                totalPages: processId === 'mock-id-1' ? 5 : 2,
                status: 'completed',
                fileType: 'application/pdf',
                createdAt: processId === 'mock-id-1' 
                ? new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
                : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 3600000).toISOString(),
                completedAt: processId === 'mock-id-1' 
                ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
                : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
                direction: processId === 'mock-id-1' ? 'ltr' : 'ltr'
            }
            };
            
            sessionStorage.setItem('viewTranslation', JSON.stringify(mockData));
        }
        
        // Navigate to the view page
        navigate(`/view/${processId}`);
        } catch (err) {
        console.error('Failed to prepare translation for viewing:', err);
        toast.error('Failed to prepare translation for viewing');
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
      'ka': 'Georgian'
    };
    
    return languages[code] || code;
  };

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-8 border border-gray-100">
      <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 px-6 py-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center">
              <Clock className="mr-2 h-5 w-5" />
              Recent Translations
            </h2>
            <p className="text-indigo-200 text-sm">Your most recent completed translations</p>
          </div>
          <button 
            onClick={fetchHistory} 
            className="text-white p-2 rounded-full hover:bg-white/10"
            disabled={loading}
            aria-label="Refresh history"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      
      <div className="p-6">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          </div>
        ) : error ? (
          <div className="bg-red-50 p-4 rounded-lg text-red-600">
            <p>{error}</p>
            <button 
              onClick={fetchHistory}
              className="mt-2 text-sm text-indigo-600 hover:text-indigo-800"
            >
              Try again
            </button>
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <h3 className="text-lg font-medium text-gray-700">No translations yet</h3>
            <p className="text-gray-500 mt-1">Your completed translations will appear here</p>
          </div>
        ) : (
          <div>
            {/* Translation history list */}
            <div className="grid md:grid-cols-2 gap-4">
              {history.map((item) => (
                <div 
                  key={item.processId}
                  className={`border rounded-lg overflow-hidden hover:border-indigo-300 transition-colors ${
                    selectedTranslation === item.processId ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-gray-200'
                  }`}
                >
                  <div className="p-4">
                    <div className="flex justify-between">
                      <h3 className="font-medium text-gray-800 truncate max-w-[200px]" title={item.fileName}>
                        {item.fileName}
                      </h3>
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                        Completed
                      </span>
                    </div>
                    
                    <div className="flex items-center text-sm mt-2 text-gray-600">
                      <span>{getLanguageName(item.fromLang)}</span>
                      <ArrowRight className="mx-2 h-3 w-3" />
                      <span>{getLanguageName(item.toLang)}</span>
                    </div>
                    
                    <div className="text-xs text-gray-500 mt-2">
                      Completed: {formatDate(item.completedAt)}
                    </div>
                    
                    <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between">
                      <button
                        onClick={() => fetchPreview(item.processId)}
                        className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center"
                        disabled={loadingPreview && selectedTranslation === item.processId}
                      >
                        {loadingPreview && selectedTranslation === item.processId ? (
                          <>
                            <Loader2 size={14} className="mr-1 animate-spin" />
                            Loading...
                          </>
                        ) : (
                          <>
                            <Eye size={14} className="mr-1" />
                            Preview
                          </>
                        )}
                      </button>
                      
                      <button
                        onClick={() => viewFullTranslation(item.processId)}
                        className="text-sm text-indigo-600 hover:text-indigo-800"
                      >
                        View Full Translation
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Preview panel */}
            {previewContent && (
              <div className="mt-6 p-4 border rounded-lg">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-gray-800">
                    {previewContent.metadata?.fileName || "Document Preview"}
                  </h3>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => viewFullTranslation(previewContent.processId)}
                      className="button-secondary text-sm px-3 py-1.5 flex items-center gap-1"
                    >
                      <Eye size={14} />
                      View Full
                    </button>
                    
                    {previewContent.hasContent && (
                      <DocumentDownloadButton
                        text={previewContent.preview}
                        language={previewContent.metadata?.toLang || "en"}
                        onError={(error) => toast.error(error)}
                        onSuccess={() => toast.success('Document downloaded successfully!')}
                        className="flex items-center gap-2"
                      />
                    )}
                  </div>
                </div>
                
                {previewContent.hasContent ? (
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 max-h-96 overflow-auto">
                    <div 
                      dangerouslySetInnerHTML={{ __html: previewContent.preview }} 
                      className="preview-content"
                    />
                    {previewContent.preview.length === 1000 && (
                      <div className="mt-4 text-center text-sm text-gray-600 italic">
                        Content preview truncated. Click "View Full" to see the entire translation.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-gray-500 text-center">
                    No content available to preview
                  </div>
                )}
                
                <div className="mt-4 pt-4 border-t border-gray-100 text-sm text-gray-500">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">Languages:</span> {getLanguageName(previewContent.metadata?.fromLang)} &rarr; {getLanguageName(previewContent.metadata?.toLang)}
                    </div>
                    <div>
                      <span className="font-medium">Pages:</span> {previewContent.metadata?.totalPages || 0}
                    </div>
                  </div>
                  <div className="mt-2">
                    <span className="font-medium">Completed:</span> {formatDate(previewContent.metadata?.completedAt)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}