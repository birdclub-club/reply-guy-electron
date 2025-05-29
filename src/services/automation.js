const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');
const { AutomationManager } = require('../automation');

let automationManager = null;

async function startAutomation(config) {
  try {
    if (!automationManager) {
      automationManager = new AutomationManager();
    }
    
    const success = await automationManager.start(config);
    return { success };
  } catch (error) {
    console.error('Error starting automation:', error);
    return { success: false, error: error.message };
  }
}

async function stopAutomation() {
  try {
    if (!automationManager) {
      return { success: true };
    }
    
    const success = await automationManager.stop();
    return { success };
  } catch (error) {
    console.error('Error stopping automation:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  startAutomation,
  stopAutomation
}; 