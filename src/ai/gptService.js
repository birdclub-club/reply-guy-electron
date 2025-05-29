const { OpenAI } = require('openai');

class GPTService {
    constructor() {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is not set in environment variables');
        }
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }

    async generateReply(targetPost, similarMemories, userStyle) {
        try {
            const systemMessage = this.constructSystemMessage(userStyle, similarMemories);
            const temperature = this.calculateTemperature(userStyle.riskLevel);
            const maxTokens = userStyle.replyLength.max;
            
            const response = await this.openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: systemMessage
                    },
                    {
                        role: "user",
                        content: `Reply to this post: "${targetPost}"`
                    }
                ],
                temperature,
                max_tokens: maxTokens,
                presence_penalty: 0.3,  // Encourage novel responses
                frequency_penalty: 0.4   // Reduce repetition
            });

            return response.choices[0].message.content + "..";
        } catch (error) {
            console.error('Error generating reply:', error.message);
            throw error;
        }
    }

    constructSystemMessage(userStyle, similarMemories) {
        const { tone, style, persona, topics, catchphrases, emojis, favoriteReplies, memeFrequency } = userStyle;
        
        let systemMessage = `You are a ${tone.primary} and ${tone.secondary} Web3 ${persona.archetype} with a ${persona.background} background. Your expertise includes ${persona.expertise.join(', ')}.\n\n`;
        
        // Style guidelines
        systemMessage += `Communication style:\n`;
        systemMessage += `- Use a ${style.formality} tone with ${style.vocabulary}\n`;
        systemMessage += `- Your punctuation style is ${style.punctuation}\n`;
        systemMessage += `- Maintain a sarcasm level of ${userStyle.riskLevel.sarcasm * 100}%\n`;
        systemMessage += `- Keep edginess at ${userStyle.riskLevel.edginess * 100}%\n\n`;
        
        // Topics and interests
        systemMessage += `Primary topics: ${topics.primary.join(', ')}\n`;
        systemMessage += `Other interests: ${topics.interests.join(', ')}\n`;
        systemMessage += `Avoid discussing: ${topics.avoidance.join(', ')}\n\n`;
        
        // Language patterns
        systemMessage += `Common phrases to use (${memeFrequency.useCatchphrases * 100}% of the time):\n`;
        systemMessage += `- Regular: ${catchphrases.common.join(', ')}\n`;
        systemMessage += `- Bullish situations: ${catchphrases.situational.bullish.join(', ')}\n`;
        systemMessage += `- Bearish situations: ${catchphrases.situational.bearish.join(', ')}\n\n`;
        
        // Emoji usage
        if (memeFrequency.useEmojis > 0) {
            systemMessage += `Preferred emojis (use ${memeFrequency.useEmojis * 100}% of the time):\n`;
            systemMessage += `- Favorites: ${emojis.favorites.join(' ')}\n`;
            systemMessage += `- Bullish: ${emojis.situational.bullish.join(' ')}\n`;
            systemMessage += `- Bearish: ${emojis.situational.bearish.join(' ')}\n\n`;
        }
        
        // Example replies
        if (favoriteReplies && favoriteReplies.length > 0) {
            systemMessage += "Style examples from past replies:\n";
            favoriteReplies.forEach((reply, index) => {
                systemMessage += `${index + 1}. "${reply}"\n`;
            });
            systemMessage += "\n";
        }
        
        // Similar memories for context
        if (similarMemories && similarMemories.length > 0) {
            systemMessage += "Relevant past interactions to consider:\n";
            similarMemories.forEach((memory, index) => {
                systemMessage += `${index + 1}. "${memory.text}"\n`;
            });
        }
        
        return systemMessage;
    }

    calculateTemperature(riskLevel) {
        // Calculate temperature (0.0-1.0) based on risk levels
        // Higher risk levels = higher temperature = more creative/random responses
        const baseTemp = 0.7;
        const riskMultiplier = (riskLevel.sarcasm + riskLevel.edginess + riskLevel.controversy) / 3;
        return Math.min(1.0, baseTemp + (riskMultiplier * 0.3));
    }
}

module.exports = GPTService; 