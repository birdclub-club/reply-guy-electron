import React, { useState, useEffect } from 'react';
import './App.css';
import AISettings from './components/AISettings';
import logoImg from '../app art/RG-Logo-Old-English.png';
import SessionVibeCard from './components/SessionVibeCard';

/** TypewriterLogLine: Animates log text as if being typed out */
function TypewriterLogLine({ text, className = '', processLogText = null }) {
  const [displayed, setDisplayed] = useState('');
  const [processedContent, setProcessedContent] = useState(null);
  
  useEffect(() => {
    let i = 0;
    setDisplayed('');
    if (!text) return;
    const interval = setInterval(() => {
      setDisplayed((prev) => prev + text[i]);
      i++;
      if (i >= text.length) {
        clearInterval(interval);
        // Process the text for clickable elements after typing is complete
        if (processLogText) {
          setProcessedContent(processLogText(text));
        }
      }
    }, 8); // Speed: 8ms per character
    return () => clearInterval(interval);
  }, [text, processLogText]);

  return (
    <div className={`automation-log-entry new ${className}`}>
      {processedContent ? processedContent : displayed}
    </div>
  );
}

function App() {
  const [status, setStatus] = useState('stopped');
  const [message, setMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [accountInfo, setAccountInfo] = useState(null);
  const [trainingData, setTrainingData] = useState(null);
  const [showTrainingOptions, setShowTrainingOptions] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(null);
  const [trainingError, setTrainingError] = useState(null);
  const [trainingComplete, setTrainingComplete] = useState(false);
  const [lastRunStartTime, setLastRunStartTime] = useState(null);
  const [lastRunDuration, setLastRunDuration] = useState(null);
  const [config, setConfig] = useState({
    timing: {
      viewDuration: 30,
      actionDelay: 5,
      notificationInterval: 900
    },
    account: {
      followThreshold: 100,
      unfollowThreshold: 1000,
      maxFollowsPerDay: 50
    },
    safety: {
      maxDailyInteractions: 100,
      pauseAfterInteractions: 30,
      pauseDuration: 15
    }
  });
  const [automationLogs, setAutomationLogs] = useState([]);
  const [accomplishments, setAccomplishments] = useState([]);
  const [openAIApiKey, setOpenAIApiKey] = useState('');
  const [replyTone, setReplyTone] = useState('Friendly');
  const [customTone, setCustomTone] = useState('');
  const [pendingComment, setPendingComment] = useState(null);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [pendingRating, setPendingRating] = useState(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [focusKeywords, setFocusKeywords] = useState([]);
  const [skipKeywords, setSkipKeywords] = useState([]);
  const [focusInput, setFocusInput] = useState('');
  const [skipInput, setSkipInput] = useState('');
  const [priorityUsers, setPriorityUsers] = useState([]);
  const [priorityInput, setPriorityInput] = useState('');
  const [apiTestResults, setApiTestResults] = useState(null);
  const [manualInput, setManualInput] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [availableImages, setAvailableImages] = useState({ gm: [], welcome: [], general: [] });
  const [selectedImage, setSelectedImage] = useState(null);
  const [showImageSelector, setShowImageSelector] = useState(false);
  const [selectedImageFolder, setSelectedImageFolder] = useState('general');
  const [trainingMetrics, setTrainingMetrics] = useState({
    manualInputs: 0,
    externalReplies: 0,
    imageSelections: 0,
    commentRatings: 0,
    lastTrainingUpdate: null
  });
  const [showLearningExamples, setShowLearningExamples] = useState(false);

  // Load stored values on component mount
  useEffect(() => {
    const loadStoredValues = async () => {
      try {
        const storedFocusKeywords = await window.electron.store.get('focusKeywords');
        const storedSkipKeywords = await window.electron.store.get('skipKeywords');
        const storedPriorityUsers = await window.electron.store.get('priorityUsers');
        const storedImageFolder = await window.electron.store.get('lastImageFolder');
        
        if (storedFocusKeywords) setFocusKeywords(storedFocusKeywords);
        if (storedSkipKeywords) setSkipKeywords(storedSkipKeywords);
        if (storedPriorityUsers) setPriorityUsers(storedPriorityUsers);
        if (storedImageFolder) setSelectedImageFolder(storedImageFolder);
      } catch (error) {
        console.error('Failed to load stored values:', error);
      }
    };
    
    loadStoredValues();
  }, []);

  useEffect(() => {
    console.log('Attaching automation-log listener');
    // Stable handler functions
    const logHandler = (message) => {
      console.log('[AUTOMATION LOG RAW]', message);
      setAutomationLogs(logs => [...logs, message]);
    };
    const accomplishmentHandler = (message) => {
      // Check if the message contains learning-related information
      if (message.includes('Learning from reply') || message.includes('Style pattern updated')) {
        // Add to accomplishments with a special learning badge
        setAccomplishments(accs => [...accs, {
          message,
          type: 'learning',
          timestamp: new Date().toISOString()
        }]);
        
        // Trigger a refresh of training metrics
        loadTrainingMetrics();
      } else {
        // Regular accomplishment
        setAccomplishments(accs => [...accs, {
          message,
          type: 'action',
          timestamp: new Date().toISOString()
        }]);
      }
    };

    window.electron.on('automation-log', logHandler);
    window.electron.on('automation-accomplishment', accomplishmentHandler);

    // Check login status and get training data when app starts
    checkLoginStatus();
    getTrainingData();

    // Set up event listeners
    window.electron.on('automation-status', (data) => {
      setStatus(data.status);
      setMessage(data.message || '');
    });

    window.electron.on('login-status', (data) => {
      setIsLoggedIn(data.isLoggedIn);
      if (data.accountInfo) {
        setAccountInfo(data.accountInfo);
      }
    });

    window.electron.on('training-progress', (data) => {
      if (typeof data.progress === 'number') {
        setTrainingProgress(data.progress);
      }
      if (data.trainingData) {
        setTrainingData(data.trainingData);
        setTrainingProgress(null);
        setTrainingError(null);
        setTrainingComplete(true);
      }
    });

    window.electron.on('automation-status', (data) => {
      if (data.status === 'error' && data.message) {
        setTrainingError(data.message);
        setTrainingProgress(null);
      }
    });

    window.electron.on('automation-comment-approval', (data) => {
      console.log('[DEBUG FRONTEND] Received approval data:', JSON.stringify(data, null, 2));
      setPendingComment(data);
      setShowApprovalModal(true);
    });

    window.electron.on('automation-comment-rating', (data) => {
      setPendingRating(data);
      setShowRatingModal(true);
    });

    return () => {
      window.electron.removeAllListeners('automation-log');
      window.electron.removeAllListeners('automation-accomplishment');
      window.electron.removeAllListeners('automation-status');
      window.electron.removeAllListeners('login-status');
      window.electron.removeAllListeners('training-progress');
      window.electron.removeAllListeners('automation-comment-approval');
      window.electron.removeAllListeners('automation-comment-rating');
    };
  }, []);

  const checkLoginStatus = async () => {
    const result = await window.electron.checkLogin();
    if (result.success) {
      setIsLoggedIn(result.isLoggedIn);
      if (result.accountInfo) {
        setAccountInfo(result.accountInfo);
      }
    }
  };

  const getTrainingData = async () => {
    const result = await window.electron.getTrainingData();
    if (result.success && result.trainingData) {
      setTrainingData(result.trainingData);
    }
  };

  const handleLogin = async () => {
    try {
      const result = await window.electron.login();
      if (result.success) {
        checkLoginStatus(); // Refresh login status after login attempt
      } else {
        setMessage('Login failed. Please try again.');
      }
    } catch (error) {
      console.error('Login error:', error);
      setMessage('Login failed. Please try again.');
    }
  };

  const handleStartTraining = async (incremental = false) => {
    setTrainingProgress(0);
    setTrainingError(null);
    setTrainingComplete(false);
    const trainingConfig = {
      incrementalTraining: incremental,
      maxTweetsToAnalyze: 1000,
      analyzeTweets: true,
      analyzeReplies: true,
      minEngagement: 5
    };
    await window.electron.startTraining(trainingConfig);
    setShowTrainingOptions(false);
  };

  const handleConfigChange = (category, setting, value) => {
    setConfig(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [setting]: Number(value)
      }
    }));
  };

  const handleToneChange = (e) => {
    setReplyTone(e.target.value);
    if (e.target.value !== 'Custom') setCustomTone('');
  };

  const handleCustomToneChange = (e) => {
    setCustomTone(e.target.value);
    setReplyTone('Custom');
  };

  const handleApiKeyChange = (e) => {
    setOpenAIApiKey(e.target.value);
  };

  const getEffectiveTone = () => (replyTone === 'Custom' ? customTone : replyTone);

  const handleFocusInputChange = (e) => setFocusInput(e.target.value);
  const handleSkipInputChange = (e) => setSkipInput(e.target.value);
  const handleFocusInputKeyDown = async (e) => {
    if (e.key === 'Enter' && focusInput.trim()) {
      const newKeywords = [...focusKeywords, focusInput.trim()];
      setFocusKeywords(newKeywords);
      await window.electron.store.set('focusKeywords', newKeywords);
      setFocusInput('');
    }
  };
  const handleSkipInputKeyDown = async (e) => {
    if (e.key === 'Enter' && skipInput.trim()) {
      const newKeywords = [...skipKeywords, skipInput.trim()];
      setSkipKeywords(newKeywords);
      await window.electron.store.set('skipKeywords', newKeywords);
      setSkipInput('');
    }
  };
  const removeFocusKeyword = async (idx) => {
    const newKeywords = focusKeywords.filter((_, i) => i !== idx);
    setFocusKeywords(newKeywords);
    await window.electron.store.set('focusKeywords', newKeywords);
  };
  const removeSkipKeyword = async (idx) => {
    const newKeywords = skipKeywords.filter((_, i) => i !== idx);
    setSkipKeywords(newKeywords);
    await window.electron.store.set('skipKeywords', newKeywords);
  };

  const handlePriorityInputChange = (e) => setPriorityInput(e.target.value);
  const handlePriorityInputKeyDown = async (e) => {
    if (e.key === 'Enter' && priorityInput.trim()) {
      const newUsers = [...priorityUsers, priorityInput.trim().replace(/^@/, '')];
      setPriorityUsers(newUsers);
      await window.electron.store.set('priorityUsers', newUsers);
      setPriorityInput('');
    }
  };
  const removePriorityUser = async (idx) => {
    const newUsers = priorityUsers.filter((_, i) => i !== idx);
    setPriorityUsers(newUsers);
    await window.electron.store.set('priorityUsers', newUsers);
  };

  const handleStart = async () => {
    try {
      setLastRunStartTime(new Date());
      setLastRunDuration(null);
      const result = await window.electron.startAutomation({
        ...config,
        openAIApiKey,
        replyTone: getEffectiveTone(),
        focusKeywords,
        skipKeywords,
        priorityUsers
      });
      if (result.success) {
        setStatus('running');
        setMessage('Automation started successfully');
      } else {
        setMessage('Failed to start automation');
      }
    } catch (error) {
      console.error('Start error:', error);
      setMessage('Failed to start automation');
    }
  };

  const handleStop = async () => {
    try {
      const result = await window.electron.stopAutomation();
      if (result.success) {
        setStatus('stopped');
        setMessage('Automation stopped');
        if (lastRunStartTime) {
          const duration = Math.floor((new Date() - lastRunStartTime) / 1000); // Duration in seconds
          setLastRunDuration(duration);
        }
      } else {
        setMessage('Failed to stop automation');
      }
    } catch (error) {
      console.error('Stop error:', error);
      setMessage('Failed to stop automation');
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds}s`);
    
    return parts.join(' ');
  };

  const formatLastRunTime = () => {
    if (!lastRunStartTime) return '';
    return lastRunStartTime.toLocaleString();
  };

  // When the approval modal opens, pick a random image for preview
  useEffect(() => {
    if (showApprovalModal && pendingComment) {
      const randomImage = getRandomImageFromFolder();
      setSelectedImage(randomImage);
    }
    // eslint-disable-next-line
  }, [showApprovalModal, pendingComment, selectedImageFolder, availableImages]);

  const handleApproveComment = () => {
    if (!selectedImage) {
      console.warn('No image selected for approval');
      return;
    }
    
    window.electron.send('automation-comment-approval-response', { 
      type: 'ACCEPT',
      tweetText: pendingComment?.tweetText || '',
      aiComment: pendingComment?.aiComment || '',
      image: selectedImage,
      authorHandle: pendingComment?.authorHandle || pendingComment?.author || pendingComment?.username || 'Unknown'
    });
    setShowApprovalModal(false);
    setPendingComment(null);
    setShowManualInput(false);
    setManualInput('');
  };

  const handleRegenerateComment = () => {
    const randomImage = getRandomImageFromFolder();
    setSelectedImage(randomImage);
    window.electron.send('automation-comment-approval-response', { 
      type: 'RE-GENERATE',
      image: randomImage,
      tweetText: pendingComment?.tweetText || '',
      context: '',
      tone: getEffectiveTone(),
      authorHandle: pendingComment?.authorHandle || pendingComment?.author || pendingComment?.username || 'Unknown'
    });
    setShowApprovalModal(false);
    setPendingComment(null);
    setShowManualInput(false);
    setManualInput('');
  };

  const handleSkipComment = () => {
    window.electron.send('automation-comment-approval-response', { type: 'SKIP', authorHandle: pendingComment?.authorHandle || pendingComment?.author || pendingComment?.username || 'Unknown' });
    setShowApprovalModal(false);
    setPendingComment(null);
    setShowManualInput(false);
    setManualInput('');
  };

  const handleManualInput = () => {
    setManualInput(pendingComment?.aiComment || '');
    setShowManualInput(true);
  };

  const handleManualInputSubmit = () => {
    if (manualInput.trim()) {
      // Debug logging using console.log so we can see it in the terminal
      console.log('[DEBUG FRONTEND] pendingComment object:', JSON.stringify(pendingComment, null, 2));
      console.log('[DEBUG FRONTEND] authorHandle options:', {
        authorHandle: pendingComment?.authorHandle,
        author: pendingComment?.author,
        username: pendingComment?.username
      });
      
      // More robust authorHandle extraction with fallback
      let authorHandle = 'Unknown';
      if (pendingComment?.authorHandle) {
        authorHandle = pendingComment.authorHandle;
      } else if (pendingComment?.author) {
        authorHandle = pendingComment.author;
      } else if (pendingComment?.username) {
        authorHandle = pendingComment.username;
      } else {
        console.error('[DEBUG FRONTEND] No valid authorHandle found in pendingComment!');
      }
      
      console.log('[DEBUG FRONTEND] Final authorHandle:', authorHandle);
      
      window.electron.send('automation-comment-approval-response', {
        type: 'MANUAL_INPUT',
        comment: manualInput.trim(),
        image: selectedImage,
        authorHandle: authorHandle,
        tweetId: pendingComment?.tweetId
      });
      setShowApprovalModal(false);
      setPendingComment(null);
      setShowManualInput(false);
      setManualInput('');
    }
  };

  const handleRateComment = (rating) => {
    window.electron.send('automation-comment-rating-response', {
      ...pendingRating,
      rating,
    });
    setShowRatingModal(false);
    setPendingRating(null);
  };

  const testApiConnections = async () => {
    try {
      const results = await window.electron.testApiConnections();
      setApiTestResults(results);
    } catch (error) {
      console.error('Error testing API connections:', error);
      setApiTestResults({
        openai: { success: false, message: 'Test failed' },
        supabase: { success: false, message: 'Test failed' }
      });
    }
  };

  const testAutomationScoring = async () => {
    try {
      const testTweet = {
        tweetId: 'test-123',
        tweetText: 'GM everyone! What are your thoughts on crypto today?',
        author: 'testuser'
      };
      
      const result = await window.electron.testAutomationScoring(testTweet, {
        focusKeywords,
        skipKeywords,
        priorityUsers
      });
      
      setAutomationLogs(prev => [...prev, `[TEST] Automation scoring test: ${JSON.stringify(result, null, 2)}`]);
    } catch (error) {
      console.error('Error testing automation scoring:', error);
      setAutomationLogs(prev => [...prev, `[TEST ERROR] ${error.message}`]);
    }
  };

  // Add this useEffect to load available images
  useEffect(() => {
    const loadImages = async () => {
      try {
        const images = await window.electron.getAvailableImages();
        setAvailableImages(images);
      } catch (error) {
        console.error('Failed to load images:', error);
      }
    };
    loadImages();
  }, []);

  // Add this function to handle image selection
  const handleImageSelect = (imagePath) => {
    // Only allow valid relative paths from availableImages
    const allImages = Object.values(availableImages).flat().map(img => img.path);
    if (allImages.includes(imagePath)) {
      setSelectedImage(imagePath);
    } else {
      console.warn('Attempted to select invalid image path:', imagePath);
      setSelectedImage(null);
    }
    setShowImageSelector(false);
  };

  // Add this function to get image preview URL
  const getImagePreviewUrl = (imagePath) => {
    return `artwork/${imagePath}`;
  };

  // Add this function to handle folder navigation
  const handleFolderClick = (category) => {
    setShowImageSelector(true);
    setSelectedImage(null);
  };

  // Add this function after handleImageSelect
  const handleFolderSelect = async (folder) => {
    setSelectedImageFolder(folder);
    setSelectedImage(null);
    // Store the selected folder
    try {
      await window.electron.store.set('lastImageFolder', folder);
    } catch (error) {
      console.error('Failed to store last image folder:', error);
    }
  };

  // Add this function after handleFolderSelect
  const getRandomImageFromFolder = () => {
    const images = availableImages[selectedImageFolder] || [];
    if (images.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * images.length);
    return images[randomIndex].path;
  };

  // Update the useEffect for loading training metrics
  useEffect(() => {
    const loadTrainingMetrics = async () => {
      try {
        const manualInputs = await window.electron.store.get('manualInputs') || [];
        const trainingData = await window.electron.store.get('trainingData') || {};
        const commentRatings = await window.electron.store.get('commentRatings') || [];
        const externalReplies = await window.electron.store.get('externalReplies') || [];
        
        // Get recent comparisons (last 3 manual inputs + external replies)
        const recentComparisons = [
          ...manualInputs.slice(-3).map(input => ({
            tweetText: input.tweetText,
            originalAIComment: input.originalAIComment,
            manualComment: input.manualComment,
            learningImpact: analyzeLearningImpact(input.originalAIComment, input.manualComment),
            source: 'app'
          })),
          ...externalReplies.slice(-3).map(reply => ({
            tweetText: reply.interaction?.context || 'External reply',
            originalAIComment: null,
            manualComment: reply.text,
            learningImpact: 'External reply pattern',
            source: 'external'
          }))
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
         .slice(0, 3); // Show only the 3 most recent

        // Calculate learning progress including external replies
        const totalInteractions = manualInputs.length + externalReplies.length;
        const highlyRatedResponses = commentRatings.filter(r => r.rating >= 4).length;
        const learningProgress = totalInteractions > 0 
          ? Math.min(100, Math.round((highlyRatedResponses / totalInteractions) * 100))
          : 0;
        
        setTrainingMetrics({
          manualInputs: manualInputs.length,
          externalReplies: externalReplies.length,
          imageSelections: trainingData.manualResponses?.filter(r => r.image)?.length || 0,
          commentRatings: commentRatings.length,
          lastTrainingUpdate: trainingData.timestamp,
          recentComparisons,
          learningProgress,
          highlyRatedResponses,
          totalInteractions
        });
      } catch (error) {
        console.error('Failed to load training metrics:', error);
      }
    };
    
    loadTrainingMetrics();
  }, [pendingComment, selectedImage]);

  // Helper function to analyze learning impact
  const analyzeLearningImpact = (aiComment, manualComment) => {
    const differences = [];
    
    // Check for tone differences
    if (aiComment.length > 0 && manualComment.length > 0) {
      const aiWords = aiComment.toLowerCase().split(/\s+/);
      const manualWords = manualComment.toLowerCase().split(/\s+/);
      
      // Check for unique words in manual response
      const uniqueManualWords = manualWords.filter(word => !aiWords.includes(word));
      if (uniqueManualWords.length > 0) {
        differences.push(`Learned ${uniqueManualWords.length} new word patterns`);
      }
      
      // Check for length difference
      const lengthDiff = Math.abs(aiComment.length - manualComment.length);
      if (lengthDiff > 20) {
        differences.push(`Adjusted response length preference`);
      }

      // Check for structural differences
      const aiHasQuestion = aiComment.includes('?');
      const manualHasQuestion = manualComment.includes('?');
      if (aiHasQuestion !== manualHasQuestion) {
        differences.push(`Learned ${manualHasQuestion ? 'question-based' : 'statement-based'} response style`);
      }
    }
    
    return differences.length > 0 
      ? differences.join(', ')
      : 'Style refinement';
  };

  // Add these new functions for handling clicks
  const handleUsernameClick = async (username) => {
    try {
      // Remove @ if present
      const cleanUsername = username.replace('@', '');
      
      // Get current priority users
      const currentPriorityUsers = await window.electron.store.get('priorityUsers') || [];
      
      // Check if username is already in the list
      if (!currentPriorityUsers.includes(cleanUsername)) {
        // Add to priority users
        const updatedPriorityUsers = [...currentPriorityUsers, cleanUsername];
        await window.electron.store.set('priorityUsers', updatedPriorityUsers);
        
        // Update local state
        setPriorityUsers(updatedPriorityUsers);
        
        // Show success message
        setAutomationLogs(prev => [...prev, `Added @${cleanUsername} to priority users`]);
      } else {
        setAutomationLogs(prev => [...prev, `@${cleanUsername} is already in priority users`]);
      }
    } catch (error) {
      console.error('Error adding priority user:', error);
      setAutomationLogs(prev => [...prev, `Error adding @${username} to priority users`]);
    }
  };

  const handleKeywordClick = async (keyword) => {
    try {
      // Clean and normalize the keyword
      const cleanKeyword = keyword.toLowerCase().trim();
      
      // Get current focus keywords
      const currentFocusKeywords = await window.electron.store.get('focusKeywords') || [];
      
      // Check if keyword is already in the list
      if (!currentFocusKeywords.includes(cleanKeyword)) {
        // Add to focus keywords
        const updatedKeywords = [...currentFocusKeywords, cleanKeyword];
        await window.electron.store.set('focusKeywords', updatedKeywords);
        
        // Update local state
        setFocusKeywords(updatedKeywords);
        
        // Show success message
        setAutomationLogs(prev => [...prev, `Added "${cleanKeyword}" to focus keywords`]);
      } else {
        setAutomationLogs(prev => [...prev, `"${cleanKeyword}" is already in focus keywords`]);
      }
    } catch (error) {
      console.error('Error adding focus keyword:', error);
      setAutomationLogs(prev => [...prev, `Error adding "${keyword}" to focus keywords`]);
    }
  };

  // Add this function to process log text
  const processLogText = (text) => {
    // Patterns to extract tweet/reply content
    const patterns = [
      /Liked tweet by @\w+: (.+)$/,
      /Replied to @\w+: (.+)$/,
      /Found reply: (.+)$/,
      /Commented to priority user @\w+: (.+)$/,
      /monitorFeed: Decided to reply \([^)]+\) to tweet: (.+)$/,
      /Replying to reply to my post: (.+)$/,
      /Generated AI comment: (.+)$/,
      /Replied to @\w+ with (?:an image|no image): (.+)$/
    ];

    // Match usernames (@username)
    const usernameRegex = /@(\w+)/g;
    // Match potential keywords (words that are not part of a URL or special format)
    const keywordRegex = /\b(?![@#])([a-zA-Z]{3,})\b/g;

    // First, check if the text matches any tweet/reply content pattern
    let matched = null;
    let content = null;
    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m) {
        matched = m;
        content = m[1];
        break;
      }
    }

    if (matched && content) {
      // Split the log into prefix and tweet/reply content
      const prefix = text.slice(0, matched.index + matched[0].length - content.length);
      let result = [prefix];
      // Process keywords in tweet/reply content only
      let keywordMatch;
      let keywordLastIndex = 0;
      while ((keywordMatch = keywordRegex.exec(content)) !== null) {
        // Add text before the keyword
        if (keywordMatch.index > keywordLastIndex) {
          result.push(content.slice(keywordLastIndex, keywordMatch.index));
        }
        const keyword = keywordMatch[1];
        if (keyword.length >= 3 && !['the', 'and', 'for', 'but', 'not', 'you', 'are', 'was', 'were', 'this', 'that', 'with', 'have', 'has', 'had'].includes(keyword.toLowerCase())) {
          result.push(
            <span 
              key={`keyword-${keywordMatch.index}`}
              className="clickable-keyword"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleKeywordClick(keyword);
              }}
              title="Click to add as focus keyword"
            >
              {keyword}
            </span>
          );
        } else {
          result.push(keyword);
        }
        keywordLastIndex = keywordMatch.index + keywordMatch[0].length;
      }
      // Add remaining text after keywords
      if (keywordLastIndex < content.length) {
        result.push(content.slice(keywordLastIndex));
      }
      return result;
    }

    // Otherwise, process usernames as before, but no clickable keywords
    let lastIndex = 0;
    let result = [];
    let match;
    while ((match = usernameRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push(text.slice(lastIndex, match.index));
      }
      const username = match[1];
      result.push(
        <span 
          key={`user-${match.index}`}
          className="clickable-username"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleUsernameClick(username);
          }}
          title="Click to add as priority user"
        >
          @{username}
        </span>
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      result.push(text.slice(lastIndex));
    }
    return result;
  };

  return (
    <div className="container">
      <div className="main-header-row">
        <div className="header-left-col">
          <div className="controls-status-row">
            <div className="start-stop-controls">
              <button
                className={`start custom-start ${status === 'running' ? 'disabled' : ''}`}
                onClick={handleStart}
                disabled={status === 'running' || !isLoggedIn}
                title={!isLoggedIn ? "Please log in first" : "Start automation"}
              >
                <svg className="start-triangle" width="56" height="64" viewBox="0 0 56 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <polygon points="0,0 56,32 0,64" fill="#2ecc71" filter="url(#glow)" />
                  <filter id="glow">
                    <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#2ecc71"/>
                  </filter>
                </svg>
              </button>
              <button
                className={`stop custom-stop ${status === 'stopped' ? 'disabled' : ''}`}
                onClick={handleStop}
                disabled={status === 'stopped'}
                title="Stop automation"
              >
                <svg className="stop-x" width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <line x1="8" y1="8" x2="48" y2="48" stroke="#e74c3c" strokeWidth="10" strokeLinecap="round" filter="url(#glowX)" />
                  <line x1="48" y1="8" x2="8" y2="48" stroke="#e74c3c" strokeWidth="10" strokeLinecap="round" filter="url(#glowX)" />
                  <filter id="glowX">
                    <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#e74c3c"/>
                  </filter>
                </svg>
              </button>
            </div>
            <div className="status-section compact left-justified">
              <h2>Status</h2>
              <div className="status-text">
                {status === 'running' ? (
                  <span className="success">Automation is running</span>
                ) : (
                  <span className="error">Automation is stopped</span>
                )}
              </div>
              <div className="message">{message}</div>
            </div>
          </div>
          <div className="accomplishments-section left-column">
            <h3>Recent Accomplishments</h3>
            <div className="accomplishments-box">
              {accomplishments.length === 0 ? (
                <div className="accomplishments-empty">No accomplishments yet</div>
              ) : (
                accomplishments.map((acc, idx) => (
                  <div key={idx} className={`accomplishments-entry ${acc.type === 'learning' ? 'learning-accomplishment' : ''}`}>
                    {acc.type === 'learning' && <span className="learning-badge">Learning</span>}
                    {acc.message}
                    <span className="accomplishment-time">{formatDate(acc.timestamp)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="automation-log-section">
            <h3>Automation Log</h3>
            <div className="automation-log-box">
              {automationLogs.length > 0 ? (
                automationLogs.slice(-100).map((entry, index) => (
                  <TypewriterLogLine 
                    key={index} 
                    text={typeof entry === 'string' ? entry : ''} 
                    processLogText={processLogText}
                  />
                ))
              ) : (
                <div className="automation-log-empty">No activity yet</div>
              )}
            </div>
          </div>
        </div>
        <div className="header-center-col">
          <div className="targeting-section border-glow-section">
            <h3>Targeting Settings</h3>
            <div className="targeting-inputs">
              <div className="input-group">
                <label>Target Keywords:</label>
                <div className="keyword-list">
                  {focusKeywords.map((kw, idx) => (
                    <span className="keyword-pill" key={kw + idx}>
                      {kw}
                      <span className="remove-x" onClick={() => removeFocusKeyword(idx)}>×</span>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={focusInput}
                    onChange={handleFocusInputChange}
                    onKeyDown={handleFocusInputKeyDown}
                    placeholder="Add keyword and press Enter"
                    className="keyword-input"
                  />
                </div>
              </div>
              <div className="input-group">
                <label>Keywords to Avoid:</label>
                <div className="keyword-list">
                  {skipKeywords.map((kw, idx) => (
                    <span className="keyword-pill" key={kw + idx}>
                      {kw}
                      <span className="remove-x" onClick={() => removeSkipKeyword(idx)}>×</span>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={skipInput}
                    onChange={handleSkipInputChange}
                    onKeyDown={handleSkipInputKeyDown}
                    placeholder="Add keyword to avoid and press Enter"
                    className="keyword-input"
                  />
                </div>
              </div>
              <div className="input-group">
                <label>Target Users' Followers:</label>
                <div className="keyword-list">
                  {priorityUsers.map((user, idx) => (
                    <span className="keyword-pill" key={user + idx}>
                      @{user}
                      <span className="remove-x" onClick={() => removePriorityUser(idx)}>×</span>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={priorityInput}
                    onChange={handlePriorityInputChange}
                    onKeyDown={handlePriorityInputKeyDown}
                    placeholder="Add @handle and press Enter"
                    className="keyword-input"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="image-folder-section border-glow-section">
            <h3>Image Settings</h3>
            <div className="folder-selection">
              <label>Select Image Folder:</label>
              <select 
                value={selectedImageFolder} 
                onChange={(e) => handleFolderSelect(e.target.value)}
                className="folder-select"
              >
                <option value="general">General</option>
                <option value="gm">GM</option>
                <option value="welcome">Welcome</option>
                <option value="pengztracted">Pengztracted</option>
              </select>
            </div>
            <div className="selected-folder-info">
              <p>Images will be randomly selected from the {selectedImageFolder} folder</p>
            </div>
          </div>
        </div>
        <div className="header-title-col">
          <div className="header-image-title-wrap">
            <img src={'/Future-Dot-Matrix-Head-01.png'} alt="Decorative Head" className="header-head-image" />
            <div className="app-title">REPLY GUY</div>
            <div className="app-subtitle">Programmed to Be Slow, Just Like You.</div>
          </div>
        </div>
      </div>
      <SessionVibeCard />
      <div className="automation-section">
        <div className="review-ai-top-right">
          {showApprovalModal && pendingComment && (
            <div className="review-section">
              <h3>Review AI Comment</h3>
              <div className="review-content">
                <div className="tweet-preview">
                  <div style={{ marginBottom: '0.5rem' }}>
                    <strong>From: </strong>
                    {(() => {
                      const reviewUsername =
                        pendingComment.authorHandle ||
                        pendingComment.author ||
                        pendingComment.username ||
                        'Unknown';
                      return (
                        <span
                          className="clickable-username"
                          onClick={() => handleUsernameClick(reviewUsername)}
                          title="Click to add to priority users"
                          style={{ cursor: 'pointer' }}
                        >
                          @{reviewUsername}
                        </span>
                      );
                    })()}
                  </div>
                  <p><strong>Tweet:</strong> {pendingComment.tweetText}</p>
                  <p><strong>AI Comment:</strong> {pendingComment.aiComment}</p>
                  {selectedImage && (
                    <div className="selected-image-preview">
                      <span>Selected Image Preview:</span>
                      <img
                        src={`artwork/${selectedImage}`}
                        alt="Selected preview"
                        className="image-preview"
                        style={{ maxWidth: '180px', maxHeight: '180px', marginTop: '0.5rem', borderRadius: '8px', border: '1px solid #ff4fd8' }}
                        onError={e => { e.target.style.display = 'none'; }}
                      />
                    </div>
                  )}
                </div>
                {showManualInput ? (
                  <div className="manual-input-section">
                    <textarea
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      placeholder="Enter your manual reply..."
                      rows={3}
                    />
                    <div className="button-group">
                      <button onClick={handleManualInputSubmit}>Submit</button>
                      <button onClick={() => setShowManualInput(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="button-group">
                    <button onClick={handleApproveComment}>Accept</button>
                    <button onClick={handleRegenerateComment}>Re-generate</button>
                    <button onClick={handleManualInput}>Manual Input</button>
                    <button onClick={handleSkipComment}>Skip</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Training Metrics Section */}
      <div className="training-metrics-section">
        <h3>Your Training Impact</h3>
        <div className="metrics-grid">
          <div className="metric-card">
            <h4>Learning Progress</h4>
            <div className="progress-circle" style={{ '--progress': trainingMetrics.learningProgress }}>
              <div className="progress-value">{trainingMetrics.learningProgress}%</div>
              <div className="progress-label">AI Understanding</div>
            </div>
            <p className="metric-description">How well the AI matches your style</p>
          </div>
          <div className="metric-card">
            <h4>Manual Inputs</h4>
            <p className="metric-value">{trainingMetrics.manualInputs}</p>
            <p className="metric-description">Times you've written your own replies</p>
          </div>
          <div className="metric-card">
            <h4>External Replies</h4>
            <p className="metric-value">{trainingMetrics.externalReplies}</p>
            <p className="metric-description">Replies made outside the app</p>
          </div>
          <div className="metric-card">
            <h4>Successful Responses</h4>
            <p className="metric-value">{trainingMetrics.highlyRatedResponses}</p>
            <p className="metric-description">AI replies you've rated highly</p>
          </div>
        </div>
        
        {/* Collapsible Learning Examples Section */}
        <div className="learning-comparison-section">
          <button 
            className="toggle-learning-examples"
            onClick={() => setShowLearningExamples(!showLearningExamples)}
          >
            {showLearningExamples ? 'Hide Learning Examples' : 'Show Learning Examples'}
          </button>
          
          {showLearningExamples && (
            <div className="comparison-grid">
              {trainingMetrics.recentComparisons.map((comparison, index) => (
                <div key={index} className="comparison-card">
                  <div className="tweet-context">
                    <strong>Original Tweet:</strong> {comparison.tweetText}
                  </div>
                  <div className="reply-comparison">
                    <div className="ai-reply">
                      <strong>AI's Reply:</strong> {comparison.originalAIComment}
                    </div>
                    <div className={`manual-reply ${comparison.source === 'external' ? 'full-width' : ''}`}>
                      {comparison.source === 'external' ? (
                        <>
                          <h5>External Reply</h5>
                          <p>{comparison.manualComment}</p>
                        </>
                      ) : (
                        <>
                          <strong>Your Reply:</strong> {comparison.manualComment}
                          <span className="source-badge">App Reply</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="learning-impact">
                    <strong>Learning Impact:</strong> {comparison.learningImpact}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="account-section">
        <div className="login-status">
          <h3>Account Status</h3>
          {isLoggedIn ? (
            <div className="account-info">
              <p className="status-text success">✓ Logged in to X</p>
              {accountInfo && (
                <p className="account-name">@{accountInfo.username}</p>
              )}
            </div>
          ) : (
            <div className="login-prompt">
              <p className="status-text error">✗ Not logged in</p>
              <button className="login" onClick={handleLogin}>
                Log in to X
              </button>
            </div>
          )}
        </div>

        <div className="training-status">
          <h3>Training Status</h3>
          {trainingProgress !== null && (
            <div className="training-progress">
              <p>Training in progress... {trainingProgress}%</p>
              <div className="progress-bar">
                <div className="progress-bar-inner" style={{ width: `${trainingProgress}%` }}></div>
              </div>
            </div>
          )}
          {(trainingProgress === 100 || trainingComplete) && (
            <div className="training-complete">
              <p style={{ color: '#27ae60', fontWeight: 'bold' }}>Training complete!</p>
              {trainingData && (
                <>
                  <p>Last trained: {formatDate(trainingData.timestamp)}</p>
                  <p>Analyzed tweets: {trainingData.tweets.length}</p>
                  {trainingData.sentimentPatterns && (
                    <div className="training-analysis">
                      <h4>Sentiment Analysis</h4>
                      <p>Average Sentiment: {trainingData.sentimentPatterns.overall.averageSentiment.toFixed(2)}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {trainingError && (
            <div className="training-error">
              <p style={{ color: '#e74c3c' }}>Training error: {trainingError}</p>
            </div>
          )}
          {trainingData && trainingProgress === null && !trainingError && !trainingComplete ? (
            <div className="training-info">
              <p>Last trained: {formatDate(trainingData.timestamp)}</p>
              <p>Analyzed tweets: {trainingData.tweets.length}</p>
            </div>
          ) : null}
          {!trainingData && trainingProgress === null && !trainingError && !trainingComplete && (
            <p>No training data available</p>
          )}
          <button 
            className="training-toggle"
            onClick={() => setShowTrainingOptions(!showTrainingOptions)}
          >
            Training Options
          </button>
          {showTrainingOptions && (
            <div className="training-options">
              <button onClick={() => handleStartTraining(false)} disabled={trainingProgress !== null}>
                Full Training
              </button>
              <button 
                onClick={() => handleStartTraining(true)}
                disabled={!trainingData || trainingProgress !== null}
              >
                Incremental Training
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Controls */}
      <div className="main-controls">
        <button
          className={`settings-toggle ${showSettings ? 'active' : ''}`}
          onClick={() => setShowSettings(!showSettings)}
        >
          {showSettings ? 'Hide Settings' : 'Show Settings'}
        </button>
      </div>

      {showSettings && (
        <div className="settings-panel">
          <div className="config-section">
            <div className="config-group">
              <h3>Timing Settings</h3>
              <div className="input-group">
                <label>View Duration (seconds):</label>
                <input
                  type="number"
                  value={config.timing.viewDuration}
                  onChange={(e) => handleConfigChange('timing', 'viewDuration', e.target.value)}
                  min="1"
                />
              </div>
              <div className="input-group">
                <label>Action Delay (seconds):</label>
                <input
                  type="number"
                  value={config.timing.actionDelay}
                  onChange={(e) => handleConfigChange('timing', 'actionDelay', e.target.value)}
                  min="1"
                />
              </div>
              <div className="input-group">
                <label>Notification Check Interval (seconds):</label>
                <input
                  type="number"
                  value={config.timing.notificationInterval}
                  onChange={(e) => handleConfigChange('timing', 'notificationInterval', e.target.value)}
                  min="900"
                />
              </div>
            </div>

            <div className="config-group">
              <h3>Account Settings</h3>
              <div className="input-group">
                <label>Follow Threshold:</label>
                <input
                  type="number"
                  value={config.account.followThreshold}
                  onChange={(e) => handleConfigChange('account', 'followThreshold', e.target.value)}
                  min="0"
                />
              </div>
              <div className="input-group">
                <label>Unfollow Threshold:</label>
                <input
                  type="number"
                  value={config.account.unfollowThreshold}
                  onChange={(e) => handleConfigChange('account', 'unfollowThreshold', e.target.value)}
                  min="0"
                />
              </div>
              <div className="input-group">
                <label>Max Follows Per Day:</label>
                <input
                  type="number"
                  value={config.account.maxFollowsPerDay}
                  onChange={(e) => handleConfigChange('account', 'maxFollowsPerDay', e.target.value)}
                  min="0"
                  max="100"
                />
              </div>
            </div>

            <div className="config-group">
              <h3>Safety Limits</h3>
              <div className="input-group">
                <label>Max Daily Interactions:</label>
                <input
                  type="number"
                  value={config.safety.maxDailyInteractions}
                  onChange={(e) => handleConfigChange('safety', 'maxDailyInteractions', e.target.value)}
                  min="0"
                  max="200"
                />
              </div>
              <div className="input-group">
                <label>Pause After Interactions:</label>
                <input
                  type="number"
                  value={config.safety.pauseAfterInteractions}
                  onChange={(e) => handleConfigChange('safety', 'pauseAfterInteractions', e.target.value)}
                  min="0"
                />
              </div>
              <div className="input-group">
                <label>Pause Duration (minutes):</label>
                <input
                  type="number"
                  value={config.safety.pauseDuration}
                  onChange={(e) => handleConfigChange('safety', 'pauseDuration', e.target.value)}
                  min="1"
                />
              </div>
            </div>

            <div className="config-group">
              <h3>AI Reply Settings</h3>
              <div className="input-group">
                <label>OpenAI API Key:</label>
                <input
                  type="password"
                  value={openAIApiKey}
                  onChange={handleApiKeyChange}
                  placeholder="sk-..."
                  autoComplete="off"
                />
              </div>
              <div className="input-group">
                <label>Reply Tone:</label>
                <select value={replyTone} onChange={handleToneChange}>
                  <option value="Friendly">Friendly</option>
                  <option value="Witty">Witty</option>
                  <option value="Professional">Professional</option>
                  <option value="Custom">Custom</option>
                </select>
              </div>
              {replyTone === 'Custom' && (
                <div className="input-group">
                  <label>Custom Tone:</label>
                  <input
                    type="text"
                    value={customTone}
                    onChange={handleCustomToneChange}
                    placeholder="Describe your tone (e.g., sarcastic, poetic)"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="api-test-results">
        {apiTestResults && (
          <div className="test-results">
            <h3>API Connection Test Results:</h3>
            <div className={`result ${apiTestResults.openai.success ? 'success' : 'error'}`}>
              OpenAI: {apiTestResults.openai.message}
            </div>
            <div className={`result ${apiTestResults.supabase.success ? 'success' : 'error'}`}>
              Supabase: {apiTestResults.supabase.message}
            </div>
          </div>
        )}
        <button onClick={testApiConnections} className="test-button">
          Test API Connections
        </button>
        <button onClick={testAutomationScoring} className="test-button">
          Test Automation Scoring
        </button>
      </div>
    </div>
  );
}

export default App; 