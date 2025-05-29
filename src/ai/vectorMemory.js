const { OpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');

class VectorMemory {
    constructor() {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is not set in environment variables');
        }
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
            throw new Error('Supabase credentials are not set in environment variables');
        }

        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY,
            {
                auth: {
                    persistSession: false
                }
            }
        );
    }

    async generateEmbedding(text) {
        try {
            const response = await this.openai.embeddings.create({
                model: "text-embedding-3-small",
                input: text,
            });
            return response.data[0].embedding;
        } catch (error) {
            console.error('Error generating embedding:', error.message);
            throw error;
        }
    }

    async storeMemory(text, metadata = {}) {
        try {
            const embedding = await this.generateEmbedding(text);
            const { data, error } = await this.supabase
                .from('memories')
                .insert({
                    text,
                    embedding,
                    metadata,
                    created_at: new Date().toISOString()
                });

            if (error) {
                console.error('Supabase error:', error.message);
                throw error;
            }
            return data;
        } catch (error) {
            console.error('Error storing memory:', error.message);
            throw error;
        }
    }

    async findSimilarMemories(text, limit = 5) {
        try {
            const embedding = await this.generateEmbedding(text);
            const { data, error } = await this.supabase.rpc('match_memories', {
                query_embedding: embedding,
                match_threshold: 0.7,
                match_count: limit
            });

            if (error) {
                console.error('Supabase error:', error.message);
                throw error;
            }
            return data;
        } catch (error) {
            console.error('Error finding similar memories:', error.message);
            throw error;
        }
    }
}

module.exports = VectorMemory; 