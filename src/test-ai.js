const AIService = require('./ai/aiService');

async function testAI() {
    try {
        console.log('Initializing AI Service...');
        const aiService = new AIService();
        await aiService.initialize();
        
        const testPosts = [
            {
                scenario: "Bullish market sentiment",
                post: "Just aped into $PEPE with my life savings 🐸"
            },
            {
                scenario: "Bearish market condition",
                post: "Did I just ape $POW at the top?"
            },
            {
                scenario: "Technical discussion",
                post: "Anyone else think L2s are the future of DeFi scaling?"
            },
            {
                scenario: "NFT enthusiasm",
                post: "Floor price is pumping! Diamond hands paying off! 💎"
            }
        ];

        for (const test of testPosts) {
            console.log(`\n\nTesting ${test.scenario}:`);
            console.log(`Post: "${test.post}"`);
            const reply = await aiService.generateReply(test.post);
            console.log('Generated reply:', reply);
            
            // Store the interaction
            await aiService.storeNewMemory(test.post, {
                type: 'test_post',
                scenario: test.scenario,
                timestamp: new Date().toISOString()
            });
            
            await aiService.storeNewMemory(reply, {
                type: 'generated_reply',
                scenario: test.scenario,
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('\nAll test scenarios completed successfully!');
        
    } catch (error) {
        console.error('Error during testing:', error.message);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
    }
}

testAI(); 