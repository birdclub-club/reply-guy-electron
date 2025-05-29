import React, { useState, useEffect } from 'react';

const SessionVibeCard = () => {
    const [sessionVibe, setSessionVibe] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [charCount, setCharCount] = useState(0);

    useEffect(() => {
        // Load sessionVibe from store on mount
        const loadVibe = async () => {
            const prefs = await window.electron.store.get('userPreferences');
            if (prefs && prefs.sessionVibe) {
                setSessionVibe(prefs.sessionVibe);
                setCharCount(prefs.sessionVibe.length);
            }
        };
        loadVibe();
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        const prefs = await window.electron.store.get('userPreferences') || {};
        prefs.sessionVibe = sessionVibe;
        await window.electron.store.set('userPreferences', prefs);
        setIsSaving(false);
    };

    const handleTextareaChange = (e) => {
        setSessionVibe(e.target.value);
        setCharCount(e.target.value.length);
    };

    return (
        <div className="session-vibe-card enhanced-section">
            <h2 className="text-xl font-semibold mb-4 text-accent-blue session-vibe-title">
                🎯 Session Vibe (PRIMARY AI GUIDE)
            </h2>
            
            <div className="session-vibe-importance-notice">
                <div className="importance-badge">HIGHEST PRIORITY</div>
                <p className="importance-text">
                    This text is now the #1 influence on AI replies. The automation will prioritize matching this style above all else.
                </p>
            </div>

            <div className="mb-4">
                <label className="block mb-2 text-accent-blue font-medium">
                    Paste text to control AI reply style
                    <span className="char-counter">({charCount} characters)</span>
                </label>
                <textarea
                    value={sessionVibe}
                    onChange={handleTextareaChange}
                    placeholder="Paste any text here to influence the AI's reply style for this session... Examples: tweets you like, conversation threads, or any text that represents your desired vibe."
                    className="w-full p-5 border-none rounded-lg h-80 min-h-[20rem] resize-none bg-[#181c23] text-[#fffbe6] text-base focus:ring-2 focus:ring-accent-blue focus:border-accent-blue transition-colors shadow-lg session-vibe-textarea"
                />
                
                <div className="session-vibe-tips">
                    <h4>💡 Enhanced Features:</h4>
                    <ul>
                        <li>✨ <strong>Style Priority:</strong> AI will match this text's tone, length, and approach exactly</li>
                        <li>🎯 <strong>Smart Targeting:</strong> Works with your keyword targeting for better context</li>
                        <li>🧠 <strong>Override Power:</strong> Takes precedence over training data when conflicts arise</li>
                        <li>📊 <strong>Score-Based:</strong> Replies are now ranked and prioritized by relevance</li>
                    </ul>
                </div>
            </div>
            
            <div className="session-vibe-actions">
            <button
                onClick={handleSave}
                disabled={isSaving}
                    className="save-vibe-btn px-4 py-2 bg-accent-blue text-[#10141a] rounded hover:bg-accent-blue-alt disabled:bg-[#444] font-bold shadow border-none"
            >
                    {isSaving ? 'Saving...' : '💾 Save Session Vibe'}
            </button>
                
                {sessionVibe && (
                    <div className="vibe-status">
                        <span className="status-indicator active"></span>
                        Session Vibe Active - AI will prioritize this style
                    </div>
                )}
            </div>
        </div>
    );
};

export default SessionVibeCard; 