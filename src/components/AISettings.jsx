import React, { useState, useEffect } from 'react';

const AISettings = () => {
    const [settings, setSettings] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [trainingData, setTrainingData] = useState(null);
    const [apiStatus, setApiStatus] = useState(null);
    const [isTestingApi, setIsTestingApi] = useState(false);

    useEffect(() => {
        // Load settings and training data when component mounts
        const loadData = async () => {
            const prefResult = await window.electron.getUserPreferences();
            if (prefResult.success && prefResult.userPreferences) {
                setSettings(prefResult.userPreferences);
            }
            const trainingResult = await window.electron.getTrainingData();
            if (trainingResult.success && trainingResult.trainingData) {
                setTrainingData(trainingResult.trainingData);
            }
        };
        loadData();
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await window.electron.setUserPreferences(settings);
            // Notify the main process to reload AI service
            if (window.electron.send) {
                window.electron.send('reload-ai-settings');
            }
        } catch (error) {
            console.error('Error saving settings:', error);
        }
        setIsSaving(false);
    };

    const updateNestedSetting = (path, value) => {
        setSettings(prev => {
            const newSettings = { ...prev };
            let current = newSettings;
            const keys = path.split('.');
            
            for (let i = 0; i < keys.length - 1; i++) {
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = value;
            return newSettings;
        });
    };

    // Get recommended settings based on training data
    const getRecommendedSettings = () => {
        if (!trainingData || !trainingData.sentimentPatterns) return null;

        const { sentimentPatterns, interactionPatterns } = trainingData;
        
        // Calculate average sentiment and engagement
        const avgSentiment = sentimentPatterns.overall.averageSentiment;
        const avgEngagement = sentimentPatterns.overall.timeOfDay.reduce((sum, hour) => 
            sum + hour.averageEngagement, 0) / 24;

        // Determine tone based on sentiment
        let recommendedTone = {
            primary: avgSentiment > 0.5 ? 'enthusiastic' : avgSentiment > 0 ? 'witty' : 'sarcastic',
            secondary: avgSentiment > 0.5 ? 'witty' : 'enthusiastic',
            intensity: Math.min(Math.abs(avgSentiment) * 1.5, 1)
        };

        // Calculate risk levels based on engagement
        const recommendedRisk = {
            sarcasm: Math.min(avgEngagement / 10, 0.8),
            edginess: Math.min(avgEngagement / 15, 0.7),
            controversy: Math.min(avgEngagement / 20, 0.6)
        };

        // Calculate meme usage based on interaction patterns
        const totalInteractions = Object.values(interactionPatterns).reduce((sum, data) => 
            sum + data.stats.totalInteractions, 0);
        const avgResponseRate = Object.values(interactionPatterns).reduce((sum, data) => 
            sum + data.stats.responseRate, 0) / Object.keys(interactionPatterns).length;

        const recommendedMemeUsage = {
            useEmojis: Math.min(avgResponseRate * 1.2, 0.8),
            useCatchphrases: Math.min(avgResponseRate * 1.1, 0.7),
            useReferences: Math.min(avgResponseRate, 0.6)
        };

        return {
            tone: recommendedTone,
            riskLevel: recommendedRisk,
            memeFrequency: recommendedMemeUsage
        };
    };

    const recommendedSettings = getRecommendedSettings();

    const testApiConnections = async () => {
        setIsTestingApi(true);
        try {
            const result = await window.electron.testApiConnections();
            setApiStatus(result);
        } catch (error) {
            setApiStatus({
                openai: { success: false, message: error.message },
                supabase: { success: false, message: error.message }
            });
        }
        setIsTestingApi(false);
    };

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold mb-6">AI Personality Settings</h1>
            
            {/* API Status Section */}
            <section className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">API Connections</h2>
                    <button
                        onClick={testApiConnections}
                        disabled={isTestingApi}
                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
                    >
                        {isTestingApi ? 'Testing...' : 'Test Connections'}
                    </button>
                </div>
                
                {apiStatus && (
                    <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
                        <div>
                            <h3 className="font-semibold mb-2">OpenAI Status:</h3>
                            <div className={`p-2 rounded ${apiStatus.openai.success ? 'bg-green-100' : 'bg-red-100'}`}>
                                {apiStatus.openai.message}
                            </div>
                        </div>
                        <div>
                            <h3 className="font-semibold mb-2">Supabase Status:</h3>
                            <div className={`p-2 rounded ${apiStatus.supabase.success ? 'bg-green-100' : 'bg-red-100'}`}>
                                {apiStatus.supabase.message}
                            </div>
                        </div>
                    </div>
                )}
            </section>

            {trainingData && (
                <div className="mb-8 p-4 bg-blue-50 rounded-lg">
                    <h2 className="text-xl font-semibold mb-2">Training Insights</h2>
                    <p className="mb-2">Based on your training data:</p>
                    <ul className="list-disc pl-5">
                        <li>Average Sentiment: {trainingData.sentimentPatterns.overall.averageSentiment.toFixed(2)}</li>
                        <li>Most Active Hour: {
                            trainingData.sentimentPatterns.overall.timeOfDay.reduce((max, hour) => 
                                hour.count > max.count ? hour : max
                            ).hour + ':00'
                        }</li>
                        <li>Total Interactions: {
                            Object.values(trainingData.interactionPatterns).reduce((sum, data) => 
                                sum + data.stats.totalInteractions, 0)
                        }</li>
                    </ul>
                    {recommendedSettings && (
                        <button
                            onClick={() => {
                                setSettings(prev => ({
                                    ...prev,
                                    ...recommendedSettings
                                }));
                            }}
                            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                        >
                            Apply Recommended Settings
                        </button>
                    )}
                </div>
            )}
            
            {/* Tone Settings */}
            <section className="mb-8">
                <h2 className="text-xl font-semibold mb-4">Tone & Style</h2>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block mb-2">Primary Tone</label>
                        <select
                            value={settings.tone?.primary || ''}
                            onChange={(e) => updateNestedSetting('tone.primary', e.target.value)}
                            className="w-full p-2 border rounded"
                        >
                            <option value="sarcastic">Sarcastic</option>
                            <option value="witty">Witty</option>
                            <option value="enthusiastic">Enthusiastic</option>
                            <option value="educational">Educational</option>
                        </select>
                    </div>
                    <div>
                        <label className="block mb-2">Secondary Tone</label>
                        <select
                            value={settings.tone?.secondary || ''}
                            onChange={(e) => updateNestedSetting('tone.secondary', e.target.value)}
                            className="w-full p-2 border rounded"
                        >
                            <option value="witty">Witty</option>
                            <option value="sarcastic">Sarcastic</option>
                            <option value="enthusiastic">Enthusiastic</option>
                            <option value="educational">Educational</option>
                        </select>
                    </div>
                    <div>
                        <label className="block mb-2">Tone Intensity (0-1)</label>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={settings.tone?.intensity || 0.8}
                            onChange={(e) => updateNestedSetting('tone.intensity', parseFloat(e.target.value))}
                            className="w-full"
                        />
                        <span className="text-sm">{settings.tone?.intensity || 0.8}</span>
                    </div>
                </div>
            </section>

            {/* Risk Level Settings */}
            <section className="mb-8">
                <h2 className="text-xl font-semibold mb-4">Risk Levels</h2>
                <div className="grid grid-cols-3 gap-4">
                    <div>
                        <label className="block mb-2">Sarcasm Level</label>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={settings.riskLevel?.sarcasm || 0.8}
                            onChange={(e) => updateNestedSetting('riskLevel.sarcasm', parseFloat(e.target.value))}
                            className="w-full"
                        />
                        <span className="text-sm">{settings.riskLevel?.sarcasm || 0.8}</span>
                    </div>
                    <div>
                        <label className="block mb-2">Edginess Level</label>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={settings.riskLevel?.edginess || 0.6}
                            onChange={(e) => updateNestedSetting('riskLevel.edginess', parseFloat(e.target.value))}
                            className="w-full"
                        />
                        <span className="text-sm">{settings.riskLevel?.edginess || 0.6}</span>
                    </div>
                    <div>
                        <label className="block mb-2">Controversy Level</label>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={settings.riskLevel?.controversy || 0.4}
                            onChange={(e) => updateNestedSetting('riskLevel.controversy', parseFloat(e.target.value))}
                            className="w-full"
                        />
                        <span className="text-sm">{settings.riskLevel?.controversy || 0.4}</span>
                    </div>
                </div>
            </section>

            {/* Meme Frequency Settings */}
            <section className="mb-8">
                <h2 className="text-xl font-semibold mb-4">Meme Usage</h2>
                <div className="grid grid-cols-3 gap-4">
                    <div>
                        <label className="block mb-2">Emoji Usage</label>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={settings.memeFrequency?.useEmojis || 0.8}
                            onChange={(e) => updateNestedSetting('memeFrequency.useEmojis', parseFloat(e.target.value))}
                            className="w-full"
                        />
                        <span className="text-sm">{settings.memeFrequency?.useEmojis || 0.8}</span>
                    </div>
                    <div>
                        <label className="block mb-2">Catchphrase Usage</label>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={settings.memeFrequency?.useCatchphrases || 0.7}
                            onChange={(e) => updateNestedSetting('memeFrequency.useCatchphrases', parseFloat(e.target.value))}
                            className="w-full"
                        />
                        <span className="text-sm">{settings.memeFrequency?.useCatchphrases || 0.7}</span>
                    </div>
                    <div>
                        <label className="block mb-2">Reference Usage</label>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={settings.memeFrequency?.useReferences || 0.6}
                            onChange={(e) => updateNestedSetting('memeFrequency.useReferences', parseFloat(e.target.value))}
                            className="w-full"
                        />
                        <span className="text-sm">{settings.memeFrequency?.useReferences || 0.6}</span>
                    </div>
                </div>
            </section>

            {/* Reply Length Settings */}
            <section className="mb-8">
                <h2 className="text-xl font-semibold mb-4">Reply Length</h2>
                <div className="grid grid-cols-3 gap-4">
                    <div>
                        <label className="block mb-2">Minimum Length</label>
                        <input
                            type="number"
                            min="10"
                            max="50"
                            value={settings.replyLength?.min || 20}
                            onChange={(e) => updateNestedSetting('replyLength.min', parseInt(e.target.value))}
                            className="w-full p-2 border rounded"
                        />
                    </div>
                    <div>
                        <label className="block mb-2">Preferred Length</label>
                        <input
                            type="number"
                            min="20"
                            max="80"
                            value={settings.replyLength?.preferred || 50}
                            onChange={(e) => updateNestedSetting('replyLength.preferred', parseInt(e.target.value))}
                            className="w-full p-2 border rounded"
                        />
                    </div>
                    <div>
                        <label className="block mb-2">Maximum Length</label>
                        <input
                            type="number"
                            min="40"
                            max="100"
                            value={settings.replyLength?.max || 100}
                            onChange={(e) => updateNestedSetting('replyLength.max', parseInt(e.target.value))}
                            className="w-full p-2 border rounded"
                        />
                    </div>
                </div>
            </section>

            {/* Session Vibe Section */}
            <section className="mb-8">
                <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-6 shadow-sm border border-purple-100">
                    <h2 className="text-xl font-semibold mb-4 text-purple-800">Session Vibe</h2>
                    <div className="mb-4">
                        <label className="block mb-2 text-purple-700 font-medium">Paste text to influence AI reply style</label>
                        <textarea
                            value={settings.sessionVibe || ''}
                            onChange={(e) => updateNestedSetting('sessionVibe', e.target.value)}
                            placeholder="Paste any text here to influence the AI's reply style for this session..."
                            className="w-full p-3 border border-purple-200 rounded-lg h-32 resize-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 transition-colors"
                        />
                        <p className="text-sm text-purple-600 mt-2">
                            This will temporarily influence the AI's style for the current session. Examples: paste tweets you like, 
                            a conversation thread, or any text that represents the vibe you want.
                        </p>
                    </div>
                </div>
            </section>

            {/* Save Button */}
            <div className="flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
                >
                    {isSaving ? 'Saving...' : 'Save Settings'}
                </button>
            </div>
        </div>
    );
};

export default AISettings; 