const VectorMemory = require('./vectorMemory');
const GPTService = require('./gptService');
const SetupWizard = require('./setupWizard');

class AIService {
    constructor() {
        this.vectorMemory = new VectorMemory();
        this.gptService = new GPTService();
        this.setupWizard = new SetupWizard();
    }

    async initialize() {
        // Initialize with default preferences if none exist
        const preferences = this.setupWizard.getUserPreferences();
        console.log('Initial preferences:', JSON.stringify(preferences, null, 2));
        if (!preferences) {
            console.log('No preferences found, collecting...');
            await this.setupWizard.collectUserPreferences();
        }
    }

    async generateReply(targetPost) {
        try {
            // Find similar memories
            const similarMemories = await this.vectorMemory.findSimilarMemories(targetPost);
            
            // Get user preferences with fallback to defaults
            const userPreferences = this.setupWizard.getUserPreferences();
            console.log('User preferences for reply:', JSON.stringify(userPreferences, null, 2));
            
            if (!userPreferences) {
                throw new Error('User preferences not found');
            }
            
            // Generate reply
            const reply = await this.gptService.generateReply(
                targetPost,
                similarMemories,
                userPreferences
            );
            
            // Store the new interaction
            await this.vectorMemory.storeMemory(targetPost, {
                type: 'target_post',
                timestamp: new Date().toISOString()
            });
            
            await this.vectorMemory.storeMemory(reply, {
                type: 'generated_reply',
                timestamp: new Date().toISOString()
            });
            
            return reply;
        } catch (error) {
            console.error('Error in generateReply:', error);
            throw error;
        }
    }

    async storeNewMemory(text, metadata = {}) {
        return await this.vectorMemory.storeMemory(text, metadata);
    }
}

module.exports = AIService; 