const VectorMemory = require('./vectorMemory');
const Store = require('electron-store');

class SetupWizard {
    constructor() {
        this.store = new Store();
        this.vectorMemory = new VectorMemory();
        this.CURRENT_VERSION = 2; // Increment this when preferences structure changes
        
        // Check if preferences need updating
        const storedPrefs = this.store.get('userPreferences');
        if (!storedPrefs || !storedPrefs.version || storedPrefs.version < this.CURRENT_VERSION) {
            console.log('Updating preferences to new format...');
            this.store.set('userPreferences', this.getDefaultPreferences());
        }
    }

    getDefaultPreferences() {
        return {
            version: this.CURRENT_VERSION,
            tone: {
                primary: 'sarcastic',
                secondary: 'witty',
                intensity: 0.8
            },
            style: {
                formality: 'casual',
                vocabulary: 'web3_slang',
                punctuation: 'relaxed'
            },
            persona: {
                archetype: 'degen_trader',
                background: 'crypto_native',
                expertise: ['DeFi', 'NFTs', 'Trading']
            },
            topics: {
                primary: ['DeFi', 'NFTs', 'Memecoins'],
                interests: ['Trading', 'Yield Farming', 'Alpha'],
                avoidance: ['Politics', 'Personal Attacks']
            },
            catchphrases: {
                common: ['WAGMI', 'NGMI', 'Ser'],
                situational: {
                    bullish: ['LFG', 'To the moon', 'Based'],
                    bearish: ['ngmi', 'down bad', 'ser...'],
                    neutral: ['probably nothing', 'gm', 'wagmi']
                }
            },
            emojis: {
                favorites: ['🚀', '🔥', '🌙', '💎', '🦍'],
                situational: {
                    bullish: ['📈', '🚀', '🌙'],
                    bearish: ['📉', '🫡', '🥲'],
                    neutral: ['👀', '🤔', '🫂']
                }
            },
            favoriteReplies: [
                'WAGMI, but only if you hydrate.',
                'Vibes farming > yield farming.',
                'Bear market is just the tutorial.',
                'Probably nothing ser... *narrator: it was something*',
                'Down bad? Time to buy high sell low as usual.'
            ],
            replyLength: {
                min: 20,
                max: 100,
                preferred: 50
            },
            riskLevel: {
                sarcasm: 0.8,
                edginess: 0.6,
                controversy: 0.4
            },
            memeFrequency: {
                useEmojis: 0.8,
                useCatchphrases: 0.7,
                useReferences: 0.6
            }
        };
    }

    async collectUserPreferences() {
        const preferences = {
            version: this.CURRENT_VERSION,
            tone: await this.promptTone(),
            style: await this.promptStyle(),
            persona: await this.promptPersona(),
            topics: await this.promptTopics(),
            catchphrases: await this.promptCatchphrases(),
            emojis: await this.promptEmojis(),
            favoriteReplies: await this.promptFavoriteReplies(),
            replyLength: await this.promptReplyLength(),
            riskLevel: await this.promptRiskLevel(),
            memeFrequency: await this.promptMemeFrequency()
        };

        this.store.set('userPreferences', preferences);
        
        if (preferences.favoriteReplies) {
            for (const reply of preferences.favoriteReplies) {
                await this.vectorMemory.storeMemory(reply, {
                    type: 'favorite_reply',
                    timestamp: new Date().toISOString()
                });
            }
        }

        return preferences;
    }

    // For now, all prompt methods will return default values
    async promptTone() {
        return this.getDefaultPreferences().tone;
    }

    async promptStyle() {
        return this.getDefaultPreferences().style;
    }

    async promptPersona() {
        return this.getDefaultPreferences().persona;
    }

    async promptTopics() {
        return this.getDefaultPreferences().topics;
    }

    async promptCatchphrases() {
        return this.getDefaultPreferences().catchphrases;
    }

    async promptEmojis() {
        return this.getDefaultPreferences().emojis;
    }

    async promptFavoriteReplies() {
        return this.getDefaultPreferences().favoriteReplies;
    }

    async promptReplyLength() {
        return this.getDefaultPreferences().replyLength;
    }

    async promptRiskLevel() {
        return this.getDefaultPreferences().riskLevel;
    }

    async promptMemeFrequency() {
        return this.getDefaultPreferences().memeFrequency;
    }

    getUserPreferences() {
        const prefs = this.store.get('userPreferences');
        if (!prefs || !prefs.version || prefs.version < this.CURRENT_VERSION) {
            return this.getDefaultPreferences();
        }
        return prefs;
    }
}

module.exports = SetupWizard; 