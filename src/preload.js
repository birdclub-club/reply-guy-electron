const { contextBridge, ipcRenderer } = require('electron');

// Whitelist of valid channels for security
const validChannels = [
  'automation-status',
  'login-status',
  'training-progress',
  'automation-log',
  'automation-accomplishment',
  'automation-comment-approval',
  'automation-comment-rating',
  'automation-comment-approval-response',
  'automation-comment-rating-response',
  'test-api-connections'
];

// Helper function to validate channels
const isValidChannel = (channel) => {
  return validChannels.includes(channel) || channel.startsWith('automation-comment-');
};

contextBridge.exposeInMainWorld('electron', {
  send: (channel, data) => {
    if (isValidChannel(channel)) {
      ipcRenderer.send(channel, data);
    } else {
      console.warn(`Invalid channel: ${channel}`);
    }
  },
  invoke: async (channel, data) => {
    if (isValidChannel(channel)) {
      try {
        return await ipcRenderer.invoke(channel, data);
      } catch (error) {
        console.error(`Error invoking ${channel}:`, error);
        throw error;
      }
    } else {
      console.warn(`Invalid channel: ${channel}`);
      throw new Error(`Invalid channel: ${channel}`);
    }
  },
  on: (channel, callback) => {
    if (isValidChannel(channel)) {
      const subscription = (event, ...args) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    } else {
      console.warn(`Invalid channel: ${channel}`);
      return () => {};
    }
  },
  checkLogin: async () => {
    return await ipcRenderer.invoke('check-login');
  },
  login: async () => {
    return await ipcRenderer.invoke('login');
  },
  startTraining: async (config) => {
    return await ipcRenderer.invoke('start-training', config);
  },
  getTrainingData: async () => {
    return await ipcRenderer.invoke('get-training-data');
  },
  startAutomation: async (config) => {
    return await ipcRenderer.invoke('start-automation', config);
  },
  stopAutomation: async () => {
    return await ipcRenderer.invoke('stop-automation');
  },
  testApiConnections: async () => {
    return await ipcRenderer.invoke('test-api-connections');
  },
  removeAllListeners: (channel) => {
    if (isValidChannel(channel)) {
      ipcRenderer.removeAllListeners(channel);
    } else {
      console.warn(`Invalid channel: ${channel}`);
    }
  },
  getUserPreferences: async () => {
    return await ipcRenderer.invoke('get-user-preferences');
  },
  setUserPreferences: async (userPreferences) => {
    return await ipcRenderer.invoke('set-user-preferences', userPreferences);
  },
  store: {
    get: async (key) => {
      return await ipcRenderer.invoke('store-get', key);
    },
    set: async (key, value) => {
      return await ipcRenderer.invoke('store-set', { key, value });
    },
    delete: async (key) => {
      return await ipcRenderer.invoke('store-delete', key);
    }
  },
  getAvailableImages: async () => {
    return await ipcRenderer.invoke('get-available-images');
  },
  getImageData: async (imagePath) => {
    return await ipcRenderer.invoke('get-image-data', imagePath);
  },
  automation: {
    start: (config) => ipcRenderer.invoke('start-automation', config),
    stop: () => ipcRenderer.invoke('stop-automation'),
    getStatus: () => ipcRenderer.invoke('get-automation-status'),
    onStatusChange: (callback) => {
      ipcRenderer.on('automation-status', (_, status) => callback(status));
      return () => ipcRenderer.removeAllListeners('automation-status');
    },
    onLog: (callback) => {
      ipcRenderer.on('automation-log', (_, log) => callback(log));
      return () => ipcRenderer.removeAllListeners('automation-log');
    },
    onAccomplishment: (callback) => {
      ipcRenderer.on('automation-accomplishment', (_, accomplishment) => callback(accomplishment));
      return () => ipcRenderer.removeAllListeners('automation-accomplishment');
    }
  },
  artwork: {
    getAvailableImages: () => ipcRenderer.invoke('get-available-images'),
    getImageData: (imagePath) => ipcRenderer.invoke('get-image-data', imagePath)
  }
}); 