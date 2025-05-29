const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables from .env file
const envPath = path.join(app.getAppPath(), '.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log('Environment variables loaded:');
    console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✓ Present' : '✗ Missing');
    console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? '✓ Present' : '✗ Missing');
    console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? '✓ Present' : '✗ Missing');
} else {
    console.warn('.env file not found. Please create one with your API keys.');
}

// Test function to verify API connections
async function testAPIConnections() {
    const results = {
        openai: { success: false, message: '' },
        supabase: { success: false, message: '' }
    };

    // Test OpenAI
    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "user", content: "Test connection" }],
            max_tokens: 5
        });
        results.openai = { 
            success: true, 
            message: 'OpenAI connection successful' 
        };
    } catch (error) {
        results.openai = { 
            success: false, 
            message: `OpenAI error: ${error.message}` 
        };
    }

    // Test Supabase
    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY,
            { auth: { persistSession: false } }
        );
        const { data, error } = await supabase.from('memories').select('count').limit(1);
        if (error) throw error;
        results.supabase = { 
            success: true, 
            message: 'Supabase connection successful' 
        };
    } catch (error) {
        results.supabase = { 
            success: false, 
            message: `Supabase error: ${error.message}` 
        };
    }

    return results;
}

const AutomationManager = require('./automation');
const store = require('./store');

let mainWindow;
let automationManager = null;

// Add this before app.whenReady()
app.whenReady().then(() => {
  // Register the artwork protocol
  protocol.registerFileProtocol('artwork', (request, callback) => {
    const url = request.url.substr(9); // Remove 'artwork://'
    const filePath = path.join(app.getAppPath(), 'artwork', url);
    callback({ path: filePath });
  });

  createWindow();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1800,
    height: 1000,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(app.getAppPath(), 'src', 'preload.js')
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  // Add error handling
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
    if (process.env.NODE_ENV === 'development') {
      mainWindow.loadURL('http://localhost:5173');
    }
  });

  automationManager = new AutomationManager();

  // Listen for training progress updates
  automationManager.on('trainingProgress', (progress, trainingData) => {
    mainWindow.webContents.send('training-progress', { 
      progress,
      trainingData
    });
  });

  // Listen for automation log events and forward to renderer
  automationManager.on('automation-log', (message) => {
    mainWindow.webContents.send('automation-log', message);
  });

  // Listen for automation accomplishment events and forward to renderer
  automationManager.on('automation-accomplishment', (message) => {
    mainWindow.webContents.send('automation-accomplishment', message);
  });

  // Listen for comment approval and rating events and forward to renderer
  automationManager.on('automation-comment-approval', (data) => {
    mainWindow.webContents.send('automation-comment-approval', data);
  });
  automationManager.on('automation-comment-rating', (data) => {
    mainWindow.webContents.send('automation-comment-rating', data);
  });

  // Listen for approval/ratings from renderer
  ipcMain.on('automation-comment-approval-response', async (event, response) => {
    console.log('[DEBUG MAIN] Received approval response:', JSON.stringify(response, null, 2));
    
    if (response.type === 'MANUAL_INPUT') {
      try {
        console.log('[DEBUG MAIN] Processing MANUAL_INPUT with authorHandle:', response.authorHandle);
        // Emit through the approval system instead of calling handleManualInput directly
        // This ensures the normalized authorHandle is used properly
        automationManager.emit('automation-comment-approval-response', response);
      } catch (error) {
        console.error('Error handling manual input:', error);
        mainWindow.webContents.send('automation-status', {
          status: 'error',
          message: `Error posting manual reply: ${error.message}`
        });
      }
    } else if (response.type === 'RE-GENERATE') {
      // Generate a new AI reply for the same tweet and show approval modal again
      try {
        const { tweetText, context, tone } = response;
        // Use the latest training data
        const trainingData = store.get('trainingData') || {};
        const aiComment = await automationManager.generateAIReply({
          apiKey: automationManager.config.openAIApiKey,
          replyText: tweetText,
          context: context || '',
          tone: tone || 'Friendly',
          trainingData
        });
        // Show the new AI comment for approval
        mainWindow.webContents.send('automation-comment-approval', {
          tweetText,
          aiComment,
          options: ['ACCEPT', 'RE-GENERATE', 'MANUAL INPUT']
        });
      } catch (error) {
        console.error('Error re-generating AI reply:', error);
        mainWindow.webContents.send('automation-status', {
          status: 'error',
          message: `Error re-generating AI reply: ${error.message}`
        });
      }
    } else if (response.type === 'SKIP') {
      // Do nothing, just continue automation
      automationManager.emit('automation-comment-approval-response', response);
    } else {
      // For ACCEPT, include the image in the response
      automationManager.emit('automation-comment-approval-response', {
        ...response,
        image: response.image
      });
    }
  });
  ipcMain.on('automation-comment-rating-response', (event, data) => {
    automationManager.handleCommentRating(data);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('check-login', async () => {
  try {
    const isLoggedIn = await automationManager.checkLoginStatus();
    mainWindow.webContents.send('login-status', { isLoggedIn });
    return { success: true, isLoggedIn };
  } catch (error) {
    console.error('Login check failed:', error);
    mainWindow.webContents.send('login-status', { isLoggedIn: false });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-training-data', () => {
  try {
    const trainingData = store.get('trainingData');
    if (trainingData) {
      mainWindow.webContents.send('training-progress', { 
        progress: 100,
        trainingData
      });
    }
    return { success: true, trainingData };
  } catch (error) {
    console.error('Failed to get training data:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('login', async () => {
  try {
    const success = await automationManager.login();
    mainWindow.webContents.send('login-status', { isLoggedIn: success });
    return { success };
  } catch (error) {
    console.error('Login failed:', error);
    mainWindow.webContents.send('login-status', { isLoggedIn: false });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-training', async (event, trainingConfig) => {
  try {
    const isLoggedIn = await automationManager.checkLoginStatus();
    if (!isLoggedIn) {
      mainWindow.webContents.send('automation-status', { 
        status: 'error',
        message: 'Not logged in'
      });
      return { success: false, error: 'Not logged in' };
    }

    // If incremental training is enabled, pass the last training timestamp
    if (trainingConfig.incrementalTraining) {
      const existingData = store.get('trainingData');
      if (existingData && existingData.timestamp) {
        trainingConfig.sinceTimestamp = existingData.timestamp;
      }
    }

    await automationManager.startTraining(trainingConfig);
    return { success: true };
  } catch (error) {
    console.error('Training failed:', error);
    mainWindow.webContents.send('automation-status', { 
      status: 'error',
      message: error.message
    });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-automation', async (event, config) => {
  try {
    if (!automationManager) {
      const { AutomationManager } = require('./automation');
      automationManager = new AutomationManager();
    }

    const success = await automationManager.start(config);
    mainWindow.webContents.send('automation-status', {
      status: success ? 'running' : 'error',
      message: success ? 'Automation started successfully' : 'Failed to start automation'
    });
    return success;
  } catch (error) {
    console.error('Error starting automation:', error);
    mainWindow.webContents.send('automation-status', {
      status: 'error',
      message: `Error starting automation: ${error.message}`
    });
    return false;
  }
});

ipcMain.handle('stop-automation', async () => {
  try {
    if (!automationManager) {
      return true; // Already stopped
    }

    const success = await automationManager.stop();
    mainWindow.webContents.send('automation-status', {
      status: 'stopped',
      message: 'Automation stopped successfully'
    });
    return success;
  } catch (error) {
    console.error('Error stopping automation:', error);
    mainWindow.webContents.send('automation-status', {
      status: 'error',
      message: `Error stopping automation: ${error.message}`
    });
    return false;
  }
});

// Add this near other IPC handlers
ipcMain.on('reload-ai-settings', () => {
    // Reinitialize AI service with new settings
    if (aiService) {
        aiService.initialize().catch(console.error);
    }
});

// Add this near other IPC handlers
ipcMain.handle('test-api-connections', async () => {
    return await testAPIConnections();
});

ipcMain.handle('get-user-preferences', async () => {
  try {
    const userPreferences = store.get('userPreferences');
    return { success: true, userPreferences };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-user-preferences', async (event, userPreferences) => {
  try {
    store.set('userPreferences', userPreferences);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('store-get', async (event, key) => {
  try {
    return store.get(key);
  } catch (error) {
    console.error('Failed to get store value:', error);
    throw error;
  }
});

ipcMain.handle('store-set', async (event, { key, value }) => {
  try {
    store.set(key, value);
    return true;
  } catch (error) {
    console.error('Failed to set store value:', error);
    throw error;
  }
});

// Add this function to get available images
function getAvailableImages() {
  const artworkPath = path.join(app.getAppPath(), 'artwork');
  const images = {
    gm: [],
    welcome: [],
    general: [],
    pengztracted: []
  };

  try {
    // Read each subdirectory
    ['gm', 'welcome', 'general', 'pengztracted'].forEach(category => {
      const categoryPath = path.join(artworkPath, category);
      if (fs.existsSync(categoryPath)) {
        // Get all subdirectories in the category
        const subdirs = fs.readdirSync(categoryPath, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name);

        // If no subdirectories, look for images in the category directory itself
        if (subdirs.length === 0) {
          const files = fs.readdirSync(categoryPath);
          images[category] = files
            .filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file))
            .map(file => ({
              name: file,
              path: path.join(category, file)
            }));
        } else {
          // Process each subdirectory
          subdirs.forEach(subdir => {
            const subdirPath = path.join(categoryPath, subdir);
            const files = fs.readdirSync(subdirPath);
            const subdirImages = files
              .filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file))
              .map(file => ({
                name: `${subdir}/${file}`,
                path: path.join(category, subdir, file)
              }));
            images[category].push(...subdirImages);
          });
        }
      }
    });
  } catch (error) {
    console.error('Error reading artwork directory:', error);
  }

  return images;
}

// Add this IPC handler
ipcMain.handle('get-available-images', () => {
  return getAvailableImages();
});

// Add this IPC handler
ipcMain.handle('get-image-data', async (event, imagePath) => {
  try {
    const fullPath = path.join(app.getAppPath(), 'artwork', imagePath);
    const imageBuffer = await fs.promises.readFile(fullPath);
    return `data:image/${path.extname(imagePath).slice(1)};base64,${imageBuffer.toString('base64')}`;
  } catch (error) {
    console.error('Error reading image:', error);
    return null;
  }
}); 