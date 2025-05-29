# Reply Guy Electron App v1.0.0

An AI-powered Twitter engagement automation tool that intelligently replies to tweets with contextual responses, featuring manual editing capabilities and robust image attachment functionality.

## 🚀 Features

### Core Functionality
- **AI Reply Generation**: Uses OpenAI GPT to generate contextual, engaging replies
- **Smart Tweet Detection**: Monitors Twitter feed for engagement opportunities
- **Manual Editing System**: Edit AI responses before posting with full image support
- **Image Attachment**: Attach artwork/images to replies with intelligent context detection
- **Automation Loop**: Continuous monitoring with configurable timing and safety limits

### Advanced Capabilities
- **Multi-Method Tweet Finding**: Robust system to locate specific tweets for replies
- **Modal-First Image Attachment**: Prevents wrong-context image uploads
- **Engagement Filtering**: Configurable thresholds for likes, replies, and sentiment
- **Cooldown System**: Prevents spam and maintains natural interaction patterns
- **Error Recovery**: Comprehensive retry logic and graceful failure handling

## 🛠 Technical Architecture

- **Frontend**: Electron + React + Vite
- **Backend**: Node.js with Puppeteer for browser automation  
- **AI**: OpenAI GPT API for response generation
- **Storage**: Electron Store for persistent data
- **Browser**: Chromium automation via Puppeteer

## 📋 Prerequisites

- Node.js (v16 or higher)
- OpenAI API key
- Twitter/X account (logged in via browser)

## 🔧 Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd reply-guy-electron
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
```

4. Configure your `.env` file:
```env
OPENAI_API_KEY=your_openai_api_key_here
SUPABASE_URL=your_supabase_url (optional)
SUPABASE_ANON_KEY=your_supabase_key (optional)
```

## 🚀 Usage

### Development Mode
```bash
npm run electron:dev
```

### Production Mode
```bash
npm start
```

### Building for Distribution
```bash
npm run electron:pack  # Package only
npm run electron:dist  # Create installer
```

## 🎯 How It Works

1. **Login**: Log into Twitter/X in your default browser
2. **Start Automation**: Launch the app and click "Start Automation"
3. **AI Monitoring**: The app scans your Twitter feed for engagement opportunities
4. **AI Generation**: When suitable tweets are found, AI generates contextual replies
5. **User Approval**: Review AI responses in the approval modal
6. **Manual Editing**: Edit responses, add images, or reject entirely
7. **Automated Posting**: Approved responses are posted automatically

## ⚙️ Configuration

### Automation Settings
```javascript
{
  timing: {
    viewDuration: 30000,        // Time spent viewing each tweet
    actionDelay: 5000,          // Delay between actions
    notificationInterval: 900000 // Check notifications every 15min
  },
  safety: {
    maxDailyInteractions: 100,  // Daily interaction limit
    pauseAfterInteractions: 30, // Pause after N interactions
    pauseDuration: 900000       // Pause duration
  },
  engagementThresholds: {
    minLikes: 1,                // Minimum likes to consider
    minReplies: 0               // Minimum replies to consider
  }
}
```

## 🎨 Artwork Integration

Place images in the `artwork/` directory structure:
```
artwork/
├── pengztracted/
│   ├── image1.jpg
│   ├── image2.gif
│   └── ...
└── other-collections/
    └── ...
```

Images are automatically detected and available in the approval modal dropdown.

## 🔒 Safety Features

- **Rate Limiting**: Respects Twitter's interaction limits
- **Cooldown System**: Prevents replying to same users too frequently  
- **Manual Approval**: All responses require user approval
- **Error Handling**: Graceful failure recovery
- **Context Validation**: Ensures replies go to correct tweets

## 📚 Documentation

See `ARCHITECTURE.md` for detailed technical documentation including:
- Component architecture
- DOM interaction patterns
- Error handling strategies
- Development workflows

## 🐛 Troubleshooting

### Browser Launch Issues
```bash
# Clear browser profile if needed
rm -rf ~/.reply-guy-profile
```

### Port Conflicts
```bash
# Kill processes using port 5173
lsof -ti:5173 | xargs kill -9
```

### Puppeteer Issues
- Ensure Chrome/Chromium is installed
- Check browser permissions
- Verify network connectivity

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- OpenAI for GPT API
- Puppeteer team for browser automation
- Electron team for cross-platform framework
- React community for UI components

---

**Version 1.0.0** - Initial release with full automation and manual editing capabilities 