const puppeteer = require('puppeteer');
const schedule = require('node-schedule');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const { EventEmitter } = require('events');
const store = require('../store');
const Sentiment = require('sentiment');
const OpenAI = require('openai');
const os = require('os');

class AutomationManager extends EventEmitter {
  constructor() {
    super();
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.scheduleJob = null;
    this.lastCheckTime = null;
    this.actionsCount = 0;
    this.maxActionsPerCycle = 10;
    this.lastActionTime = null;
    this.sentiment = new Sentiment();
    this.interactionPatterns = new Map();
    this.config = null;
    this.stats = {
      interactions: 0,
      dailyInteractions: 0,
      lastPause: null
    };
    this.processedReplyIds = new Set(store.get('processedReplyIds') || []);
    this._cachedUsername = null;
    this.lastReplyTimes = new Map(); // Store last reply time for each user
    this.COOLDOWN_PERIOD = 3 * 60 * 60 * 1000; // 3 hours in milliseconds
    this.loadLastReplyTimes();
    this.lastNotificationCheck = 0; // Track last notification check time
    this.processedTweetIds = new Set(); // Track processed tweet IDs
  }

  setConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig
    };
    console.log('Updated automation config:', this.config);
  }

  async initBrowser() {
    if (!this.browser) {
      // Always remove the lock files before every launch attempt
      const userDataDir = path.join(os.homedir(), '.reply-guy-profile');
      const lockFile = path.join(userDataDir, 'SingletonLock');
      const defaultLockFile = path.join(userDataDir, 'Default', 'SingletonLock');
      try {
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
        }
        if (fs.existsSync(defaultLockFile)) {
          fs.unlinkSync(defaultLockFile);
        }
      } catch (error) {
        console.warn('Error cleaning up browser lock files:', error);
      }
      try {
        // Remove lock files again right before launching
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
        }
        if (fs.existsSync(defaultLockFile)) {
          fs.unlinkSync(defaultLockFile);
        }
        this.browser = await puppeteer.launch({
          headless: false,
          defaultViewport: null,
          userDataDir: userDataDir,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-features=TranslateUI',
            '--disable-extensions',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--mute-audio'
          ],
        });
        // Close all but the first tab
        const pages = await this.browser.pages();
        for (let i = 1; i < pages.length; i++) {
          await pages[i].close();
        }
        this.page = pages[0];
        await this.page.goto('https://x.com/home');
        // Dismiss the restore popup if it appears
        try {
          await this.page.waitForSelector('button', { timeout: 3000 });
          const restoreButton = await this.page.$x("//button[contains(., 'Restore')]");
          if (restoreButton.length) {
            await restoreButton[0].click();
          }
        } catch (e) {}
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      } catch (error) {
        console.error('Failed to initialize browser:', error);
        // Try one more time with a fresh launch, but DO NOT delete the userDataDir
        try {
          // Remove lock files again before retry
          if (fs.existsSync(lockFile)) {
            fs.unlinkSync(lockFile);
          }
          if (fs.existsSync(defaultLockFile)) {
            fs.unlinkSync(defaultLockFile);
          }
          this.browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            userDataDir: userDataDir,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--disable-gpu',
              '--no-first-run',
              '--no-default-browser-check',
              '--disable-features=TranslateUI',
              '--disable-extensions',
              '--disable-component-extensions-with-background-pages',
              '--disable-default-apps',
              '--mute-audio'
            ],
          });
          const pages = await this.browser.pages();
          this.page = pages[0];
          await this.page.goto('https://x.com/home');
        } catch (retryError) {
          console.error('Failed to initialize browser after retry:', retryError);
          throw retryError;
        }
      }
    }
    return this.page;
  }

  async saveCookies() {
    if (this.page) {
      const cookies = await this.page.cookies();
      store.set('session', {
        cookies,
        lastLogin: new Date().toISOString()
      });
    }
  }

  async checkLoginStatus() {
    try {
      await this.initBrowser();
      console.log('Navigating to https://x.com/home for login check...');
      await this.page.goto('https://x.com/home');
      
      // Check if we're on the login page
      const loginButton = await this.page.$('a[href="/login"]');
      const isLoggedIn = !loginButton;
      
      if (isLoggedIn) {
        await this.saveCookies();
      }
      
      return isLoggedIn;
    } catch (error) {
      console.error('Error checking login status:', error);
      return false;
    }
  }

  async login() {
    try {
      await this.initBrowser();
      console.log('Navigating to https://x.com/login for login...');
      await this.page.goto('https://x.com/login');
      
      // Wait for manual login
      await this.page.waitForNavigation({
        waitUntil: 'networkidle0',
        timeout: 300000 // 5 minute timeout for manual login
      });
      
      // Save cookies after successful login
      await this.saveCookies();
      
      return true;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  }

  async startTraining(config) {
    try {
      const isLoggedIn = await this.checkLoginStatus();
      if (!isLoggedIn) {
        throw new Error('Not logged in');
      }

      this.emit('trainingProgress', 0);
      
      // Load existing interaction patterns
      const savedPatterns = store.get('interactionPatterns');
      if (savedPatterns) {
        this.interactionPatterns = new Map(Object.entries(savedPatterns));
      }

      // Navigate to profile
      console.log('Navigating to https://x.com/home for tweets collection...');
      await this.page.goto('https://x.com/home');

      const tweets = [];
      let progress = 0;
      
      // Collect tweets
      if (config.analyzeTweets) {
        const profileTweets = await this.collectTweets(config.maxTweetsToAnalyze / 2);
        tweets.push(...profileTweets);
        progress = 25;
        this.emit('trainingProgress', progress);
      }
      
      // Collect replies
      if (config.analyzeReplies) {
        const replies = await this.collectReplies(config.maxTweetsToAnalyze / 2);
        tweets.push(...replies);
        progress = 50;
        this.emit('trainingProgress', progress);
      }

      // Collect external replies (replies made outside the app)
      if (config.includeExternalReplies) {
        console.log('Collecting external replies...');
        const externalReplies = await this.collectExternalReplies();
        tweets.push(...externalReplies);
        progress = 75;
        this.emit('trainingProgress', progress);
      }
      
      // Filter by engagement and analyze patterns
      const engagedTweets = tweets.filter(tweet => 
        tweet.stats.likes >= config.minEngagement || 
        tweet.stats.replies >= config.minEngagement
      );

      // Analyze sentiment patterns
      const sentimentPatterns = this.analyzeSentimentPatterns(engagedTweets);
      
      // Save the training data
      store.set('trainingData', {
        tweets: engagedTweets,
        sentimentPatterns,
        interactionPatterns: Object.fromEntries(this.interactionPatterns),
        timestamp: new Date().toISOString()
      });
      
      progress = 100;
      this.emit('trainingProgress', progress);
      
      return true;
    } catch (error) {
      console.error('Training error:', error);
      throw error;
    }
  }

  async collectTweets(maxTweets) {
    try {
      console.log('Collecting tweets...');
      const tweets = [];

      // Navigate to profile
      console.log('Navigating to https://x.com/home for collectTweets...');
      await this.page.goto('https://x.com/home');
      await this.page.waitForSelector('[aria-label="Profile"]');
      await this.safeClick('[aria-label="Profile"]');
      await this.page.waitForSelector('[data-testid="tweet"]');

      let lastTweetCount = 0;
      let noNewTweetsCount = 0;

      while (tweets.length < maxTweets && noNewTweetsCount < 3) {
        // Get all tweets on the page
        const tweetElements = await this.page.$$('[data-testid="tweet"]');
        
        for (const tweetEl of tweetElements) {
          if (tweets.length >= maxTweets) break;

          try {
            const tweet = await this.extractTweetData(tweetEl);
            if (tweet && !tweets.some(t => t.id === tweet.id)) {
              tweets.push(tweet);
              console.log(`Collected tweet ${tweets.length}/${maxTweets}`);
            }
          } catch (error) {
            console.error('Error extracting tweet data:', error);
            continue;
          }
        }

        // Check if we found any new tweets
        if (tweets.length === lastTweetCount) {
          noNewTweetsCount++;
        } else {
          noNewTweetsCount = 0;
        }
        lastTweetCount = tweets.length;

        // Scroll down
        await this.humanLikeScroll();
        await this.randomDelay(1000, 2000);
      }

      return tweets;
    } catch (error) {
      console.error('Error collecting tweets:', error);
      return [];
    }
  }

  async collectReplies(maxReplies) {
    try {
      console.log('Collecting replies...');
      const replies = [];

      // Dynamically get the logged-in username from the profile link
      console.log('Navigating to https://x.com/home to get profile link...');
      await this.page.goto('https://x.com/home');
      await this.page.waitForSelector('[data-testid="AppTabBar_Profile_Link"]', { timeout: 15000 });
      const profileLink = await this.page.$('[data-testid="AppTabBar_Profile_Link"]');
      const href = await profileLink.evaluate(el => el.getAttribute('href'));
      const username = href.replace('/', '');
      const repliesUrl = `https://x.com/${username}/with_replies`;
      await this.page.goto(repliesUrl);
      console.log(`Navigated directly to: ${repliesUrl}`);
      await this.page.waitForSelector('[data-testid="tweet"]');

      let lastReplyCount = 0;
      let noNewRepliesCount = 0;

      while (replies.length < maxReplies && noNewRepliesCount < 3) {
        // Get all replies on the page
        const replyElements = await this.page.$$('[data-testid="tweet"]');
        
        for (const replyEl of replyElements) {
          if (replies.length >= maxReplies) break;

          try {
            // Check if it's a reply
            const isReply = await replyEl.$('[data-testid="Tweet-User-Avatar"]');
            if (!isReply) continue;

            const reply = await this.extractTweetData(replyEl);
            if (reply && !replies.some(r => r.id === reply.id)) {
              replies.push(reply);
              console.log(`Collected reply ${replies.length}/${maxReplies}`);
            }
          } catch (error) {
            console.error('Error extracting reply data:', error);
            continue;
          }
        }

        // Check if we found any new replies
        if (replies.length === lastReplyCount) {
          noNewRepliesCount++;
        } else {
          noNewRepliesCount = 0;
        }
        lastReplyCount = replies.length;

        // Scroll down
        await this.humanLikeScroll();
        await this.randomDelay(1000, 2000);
      }

      return replies;
    } catch (error) {
      console.error('Error collecting replies:', error);
      return [];
    }
  }

  async collectExternalReplies() {
    try {
      console.log('Collecting external replies...');
      const externalReplies = [];

      // Navigate to replies tab
      const username = this._cachedUsername;
      if (!username) {
        throw new Error('Username not found');
      }

      const repliesUrl = `https://x.com/${username}/with_replies`;
      await this.page.goto(repliesUrl);
      await this.page.waitForSelector('[data-testid="tweet"]');

      let lastReplyCount = 0;
      let noNewRepliesCount = 0;
      const maxReplies = 100; // Limit to last 100 replies

      while (externalReplies.length < maxReplies && noNewRepliesCount < 3) {
        const replyElements = await this.page.$$('[data-testid="tweet"]');
        
        for (const replyEl of replyElements) {
          if (externalReplies.length >= maxReplies) break;

          try {
            // Check if it's a reply
            const isReply = await replyEl.$('[data-testid="Tweet-User-Avatar"]');
            if (!isReply) continue;

            const reply = await this.extractTweetData(replyEl);
            if (reply && !externalReplies.some(r => r.id === reply.id)) {
              // Add metadata to identify as external reply
              reply.source = 'external';
              reply.timestamp = new Date().toISOString();
              externalReplies.push(reply);
              console.log(`Collected external reply ${externalReplies.length}/${maxReplies}`);
            }
          } catch (error) {
            console.error('Error extracting external reply data:', error);
            continue;
          }
        }

        if (externalReplies.length === lastReplyCount) {
          noNewRepliesCount++;
        } else {
          noNewRepliesCount = 0;
        }
        lastReplyCount = externalReplies.length;

        await this.humanLikeScroll();
        await this.randomDelay(1000, 2000);
      }

      // Store external replies for future reference
      const existingExternalReplies = store.get('externalReplies') || [];
      const newExternalReplies = externalReplies.filter(reply => 
        !existingExternalReplies.some(existing => existing.id === reply.id)
      );
      
      if (newExternalReplies.length > 0) {
        store.set('externalReplies', [...existingExternalReplies, ...newExternalReplies]);
        console.log(`Added ${newExternalReplies.length} new external replies to training data`);
      }

      return externalReplies;
    } catch (error) {
      console.error('Error collecting external replies:', error);
      return [];
    }
  }

  async extractTweetData(tweetElement) {
    try {
      // Enhanced selectors for current Twitter/X structure
      
      // Get tweet text with multiple fallback strategies
      let tweetText = '';
      const textSelectors = [
        '[data-testid="tweetText"]',
        '[data-testid="tweetText"] span',
        'div[lang] span:not([data-testid="User-Name"] span)',
        'div[dir="auto"] span:not([data-testid="User-Name"] span)',
        'div[data-testid="tweetText"] > span',
        '[role="article"] div[lang] > span'
      ];
      
      // Detect if this is a reply vs main tweet
      let isReply = false;
      let replyToUsername = null;
      try {
        // Method 1: Look for "Replying to" text in the tweet element
        const allSpans = await tweetElement.$$('span, div[dir="ltr"]');
        for (const span of allSpans) {
          const text = await span.evaluate(el => el.textContent || el.innerText);
          if (text && text.includes('Replying to')) {
            isReply = true;
            // Try to extract the username being replied to
            if (text.includes('@')) {
              const match = text.match(/@(\w+)/);
              if (match) {
                replyToUsername = match[1];
              }
            }
            break;
          }
        }
        
        // Method 2: Check for reply thread lines or indicators
        if (!isReply) {
          const replyLines = await tweetElement.$$('div[style*="position: absolute"], div[data-testid="tweet"] > div:first-child > div:first-child');
          if (replyLines.length > 0) {
            // Check if there are visual reply thread indicators
            for (const line of replyLines) {
              const lineStyle = await line.evaluate(el => el.style.cssText || '');
              if (lineStyle.includes('position') || lineStyle.includes('border') || lineStyle.includes('background')) {
                isReply = true;
                break;
              }
            }
          }
        }
        
        // Method 3: Check tweet structure for reply indicators
        if (!isReply) {
          const tweetStructure = await tweetElement.evaluate(el => {
            // Look for specific structural patterns that indicate replies
            const hasReplyToText = el.textContent && el.textContent.includes('Replying to');
            const hasReplyingStructure = el.querySelector('div[data-testid="tweetText"]')?.previousElementSibling?.textContent?.includes('Replying to');
            return hasReplyToText || hasReplyingStructure;
          });
          isReply = tweetStructure;
        }
      } catch (e) {
        // Continue with isReply = false if detection fails
      }
      
      for (const selector of textSelectors) {
        try {
          const textEl = await tweetElement.$(selector);
          if (textEl) {
            const extractedText = await textEl.evaluate(el => el.textContent || el.innerText);
            if (extractedText && extractedText.trim().length > 0) {
              // Validate this isn't just a username or profile name
              const isUsername = extractedText.trim().startsWith('@') || 
                                extractedText.trim().match(/^[A-Za-z0-9_\s]+$/) && extractedText.trim().length < 50;
              if (!isUsername) {
                tweetText = extractedText.trim();
                break;
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // If still no text found, try getting all text content and filtering
      if (!tweetText) {
        try {
          const allTextElements = await tweetElement.$$('div[lang] span, div[dir="auto"] span');
          for (const textEl of allTextElements) {
            const text = await textEl.evaluate(el => el.textContent || el.innerText);
            if (text && text.trim().length > 10 && !text.includes('@') && !text.match(/^\w+\s*\w*$/)) {
              tweetText = text.trim();
              break;
            }
          }
        } catch (e) {
          // Continue with empty text if all methods fail
        }
      }
      
      // Get author username/handle
      let author = '';
      try {
        const authorEl = await tweetElement.$('[data-testid="User-Name"] a[role="link"], a[href*="/"] span[dir="ltr"]');
        if (authorEl) {
          author = await authorEl.evaluate(el => {
            const text = el.textContent || el.innerText || '';
            // Clean up the text to get just the handle
            return text.replace('@', '').trim();
          });
        }
        
        // Fallback: try another selector for username
        if (!author) {
          const userLink = await tweetElement.$('a[href^="/"][role="link"]:not([href*="/status/"])');
          if (userLink) {
            const href = await userLink.evaluate(el => el.getAttribute('href'));
            if (href && href.startsWith('/') && !href.includes('/status/')) {
              author = href.substring(1); // Remove leading slash
            }
          }
        }
      } catch (e) {
        // Continue with empty author if extraction fails
      }

      // Get tweet ID from the link
      let tweetId = '';
      try {
      const linkEl = await tweetElement.$('a[href*="/status/"]');
        if (linkEl) {
          const href = await linkEl.evaluate(el => el.getAttribute('href'));
          if (href && href.includes('/status/')) {
            tweetId = href.split('/status/')[1].split('?')[0]; // Clean ID without params
          }
        }
      } catch (e) {
        // Fallback to timestamp-based ID if extraction fails
        tweetId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      }

      // Get tweet timestamp
      let timestamp = '';
      try {
        const timeEl = await tweetElement.$('time');
        if (timeEl) {
          timestamp = await timeEl.evaluate(el => el.getAttribute('datetime') || el.getAttribute('title'));
        }
      } catch (e) {
        timestamp = new Date().toISOString();
      }

      // Get tweet stats (likes, replies, etc.)
      let stats = { replies: 0, likes: 0, retweets: 0 };
      try {
        const statsGroup = await tweetElement.$('[role="group"]');
        if (statsGroup) {
          stats = await statsGroup.evaluate(el => {
            const result = { replies: 0, likes: 0, retweets: 0 };
            const buttons = el.querySelectorAll('[data-testid*="reply"], [data-testid*="like"], [data-testid*="retweet"]');
            
            buttons.forEach(button => {
              const testId = button.getAttribute('data-testid') || '';
              const text = button.textContent || button.innerText || '';
              const count = parseInt(text.replace(/[^\d]/g, '')) || 0;
              
              if (testId.includes('reply')) {
                result.replies = count;
              } else if (testId.includes('like')) {
                result.likes = count;
              } else if (testId.includes('retweet')) {
                result.retweets = count;
              }
            });
            
            return result;
          });
        }
      } catch (e) {
        // Keep default stats if extraction fails
      }

      // Check for media
      let hasMedia = false;
      try {
        const mediaElements = await tweetElement.$$('[data-testid="tweetPhoto"], [data-testid="tweetVideo"], img[alt*="Image"], video');
        hasMedia = mediaElements.length > 0;
      } catch (e) {
        hasMedia = false;
      }

      // Detect if this is a promoted/sponsored tweet (Ad)
      let isPromoted = false;
      try {
        // Method 1: Look for "Ad" text in the tweet element
        const adIndicators = await tweetElement.$$('span, div');
        for (const indicator of adIndicators) {
          const text = await indicator.evaluate(el => el.textContent || el.innerText);
          if (text && (text.trim() === 'Ad' || text.trim() === 'Promoted' || text.trim() === 'Sponsored')) {
            isPromoted = true;
            break;
          }
        }
        
        // Method 2: Look for promoted tweet selectors and attributes
        if (!isPromoted) {
          const promotedSelectors = [
            '[data-testid="socialContext"]', // Twitter's promoted indicator
            '[aria-label*="Promoted"]',
            '[aria-label*="Sponsored"]',
            '[data-testid="promotedIndicator"]', // Common promoted indicator
            'div[role="button"][aria-label*="Ad"]'
          ];
          
          for (const selector of promotedSelectors) {
            try {
              const element = await tweetElement.$(selector);
              if (element) {
                const text = await element.evaluate(el => el.textContent || el.innerText || el.getAttribute('aria-label'));
                if (text && (text.includes('Promoted') || text.includes('Ad') || text.includes('Sponsored'))) {
                  isPromoted = true;
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }
          
          // Check for promoted structure patterns
          if (!isPromoted) {
            const hasPromotedStructure = await tweetElement.evaluate(el => {
              // Look for promoted indicators in the tweet structure
              const allText = el.textContent || el.innerText || '';
              // Check if the tweet element contains promotional indicators
              const hasAdText = allText.includes(' Ad ') || allText.includes('Promoted') || allText.includes('Sponsored');
              // Check for aria-labels that indicate promotion
              const hasPromotedAria = el.querySelector('[aria-label*="Promoted"], [aria-label*="Sponsored"], [aria-label*="Ad"]');
              return hasAdText || !!hasPromotedAria;
            });
            isPromoted = hasPromotedStructure;
          }
        }
        
        // Method 3: Check for promoted URL patterns
        if (!isPromoted) {
          const links = await tweetElement.$$('a[href]');
          for (const link of links) {
            const href = await link.evaluate(el => el.getAttribute('href'));
            if (href && (href.includes('utm_') || href.includes('twclid=') || href.includes('promo'))) {
              isPromoted = true;
              break;
            }
          }
        }
      } catch (e) {
        // Continue with isPromoted = false if detection fails
      }

      // Debug logging for tweet extraction
      this.log(`[EXTRACT DEBUG] TweetID: ${tweetId}, Author: "${author}", TweetText: "${tweetText.substring(0, 100)}${tweetText.length > 100 ? '...' : ''}"${isPromoted ? ' [PROMOTED]' : ''}${isReply ? ' [REPLY]' : ''}`);
      
      // Basic validation - require at least some text or author info
      if (!tweetText && !author) {
        this.log(`[EXTRACT ERROR] No tweet text or author found for tweet ${tweetId}`);
        return null;
      }

      // Additional validation - make sure tweetText isn't just the author name
      if (tweetText && author && tweetText.toLowerCase().trim() === author.toLowerCase().trim()) {
        this.log(`[EXTRACT WARNING] Tweet text appears to be same as author name: "${tweetText}" vs "${author}"`);
        // Try to get tweet text one more time with different approach
        try {
          const fallbackText = await tweetElement.evaluate(el => {
            // Look for text that's clearly not username/profile info
            const allSpans = el.querySelectorAll('span');
            for (const span of allSpans) {
              const text = span.textContent || span.innerText;
              if (text && text.length > 20 && !text.includes('@') && !span.closest('[data-testid="User-Name"]')) {
                return text;
              }
            }
            return null;
          });
          if (fallbackText) {
            tweetText = fallbackText.trim();
            this.log(`[EXTRACT RECOVERY] Found better tweet text: "${tweetText.substring(0, 100)}${tweetText.length > 100 ? '...' : ''}"`);
          }
        } catch (e) {
          this.log(`[EXTRACT FALLBACK ERROR] ${e.message}`);
        }
      }

      // Return with consistent property names used throughout the app
      return {
        tweetId: tweetId,
        tweetText: tweetText,
        author: author,
        timestamp: timestamp,
        stats: stats,
        hasMedia: hasMedia,
        isReply: isReply,
        replyToUsername: replyToUsername,
        isPromoted: isPromoted,
        // Legacy compatibility
        id: tweetId,
        text: tweetText
      };
      
    } catch (error) {
      this.log(`[ERROR] extractTweetData failed: ${error.message}`);
      return null;
    }
  }

  analyzeSentiment(text) {
    const result = this.sentiment.analyze(text);
    return {
      score: result.score,
      comparative: result.comparative,
      tokens: result.tokens,
      positive: result.positive,
      negative: result.negative
    };
  }

  async extractInteractionData(tweetElement) {
    try {
      const data = {
        type: 'original', // default: original tweet
        interactingWith: null,
        context: null
      };

      // Check if this is a reply
      const replyContext = await tweetElement.$('[data-testid="Tweet-User-Avatar"]');
      if (replyContext) {
        data.type = 'reply';
        
        // Get who we're replying to
        const userLink = await tweetElement.$('a[href*="/status/"]');
        if (userLink) {
          const username = await userLink.evaluate(el => {
            const usernameEl = el.querySelector('span');
            return usernameEl ? usernameEl.textContent : null;
          });
          data.interactingWith = username;
        }

        // Get the context of the conversation
        const contextEl = await tweetElement.$('[data-testid="tweet"]');
        if (contextEl) {
          const contextText = await contextEl.evaluate(el => {
            const textEl = el.querySelector('[data-testid="tweetText"]');
            return textEl ? textEl.textContent : null;
          });
          data.context = contextText;
        }

        // Update interaction patterns
        if (data.interactingWith) {
          this.updateInteractionPatterns(data.interactingWith, {
            timestamp: new Date().toISOString(),
            type: data.type,
            sentiment: this.analyzeSentiment(data.context || '')
          });
        }
      }

      return data;
    } catch (error) {
      console.error('Error extracting interaction data:', error);
      return null;
    }
  }

  updateInteractionPatterns(username, interaction) {
    if (!this.interactionPatterns.has(username)) {
      this.interactionPatterns.set(username, {
        interactions: [],
        stats: {
          totalInteractions: 0,
          averageSentiment: 0,
          responseRate: 0,
          lastInteraction: null
        }
      });
    }

    const userData = this.interactionPatterns.get(username);
    userData.interactions.push(interaction);
    
    // Update stats
    const stats = userData.stats;
    stats.totalInteractions++;
    stats.lastInteraction = interaction.timestamp;
    
    // Calculate average sentiment
    const totalSentiment = userData.interactions.reduce((sum, int) => 
      sum + (int.sentiment ? int.sentiment.score : 0), 0);
    stats.averageSentiment = totalSentiment / stats.totalInteractions;

    // Calculate response rate (how often they respond to our interactions)
    const responses = userData.interactions.filter(int => 
      int.type === 'reply' && int.timestamp > stats.lastInteraction).length;
    stats.responseRate = responses / stats.totalInteractions;

    // Save updated patterns
    store.set('interactionPatterns', Object.fromEntries(this.interactionPatterns));
  }

  async start(config) {
    if (this.isRunning) {
      this.log('Automation already running');
      return false;
    }

    try {
      this.log('Automation started!');
      
      // Load saved API key if not provided in config
      const savedConfig = store.get('automationConfig') || {};
      const openAIApiKey = config.openAIApiKey || savedConfig.openAIApiKey;
      
      this.config = {
        timing: {
          viewDuration: config.timing.viewDuration * 1000, // convert to ms
          actionDelay: config.timing.actionDelay * 1000,
          notificationInterval: config.timing.notificationInterval * 1000
        },
        account: {
          followThreshold: config.account.followThreshold,
          unfollowThreshold: config.account.unfollowThreshold,
          maxFollowsPerDay: config.account.maxFollowsPerDay
        },
        safety: {
          maxDailyInteractions: config.safety.maxDailyInteractions,
          pauseAfterInteractions: config.safety.pauseAfterInteractions,
          pauseDuration: config.safety.pauseDuration * 60 * 1000 // convert to ms
        },
        openAIApiKey: openAIApiKey,
        replyTone: config.replyTone || 'Friendly',
        focusKeywords: config.focusKeywords || [],
        skipKeywords: config.skipKeywords || [],
        priorityUsers: config.priorityUsers || [],
        // Add default engagement thresholds
        engagementThresholds: {
          minLikes: 1,    // Reply to tweets with at least 1 like
          minReplies: 0   // Reply to tweets with any replies
        },
        // Add default sentiment thresholds
        sentimentThresholds: {
          positiveThreshold: 0,  // Reply to any positive sentiment
          negativeThreshold: 0   // Reply to any negative sentiment
        }
      };

      // Save the config with API key
      store.set('automationConfig', {
        ...savedConfig,
        ...this.config,
        openAIApiKey: openAIApiKey
      });

      // Test OpenAI API key if provided
      if (this.config.openAIApiKey) {
        const isApiKeyValid = await this.testOpenAIKey(this.config.openAIApiKey);
        if (!isApiKeyValid) {
          this.log('Warning: OpenAI API key test failed. AI replies will not work.');
        } else {
          this.log('OpenAI API key test successful. AI replies are enabled.');
        }
      } else {
        this.log('No OpenAI API key provided. AI replies will not work.');
      }

      this.log('Starting automation with config: ' + JSON.stringify(this.config, null, 2));
      
      if (!this.browser) {
        await this.initBrowser();
      }

      if (!this.page) {
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1280, height: 800 });
      }

      this.isRunning = true;
      this.stats = {
        interactions: 0,
        dailyInteractions: 0,
        lastPause: null
      };

      // Start the main automation loop
      this.automationLoop();
      
      return true;
    } catch (error) {
      this.log('Failed to start automation: ' + error);
      return false;
    }
  }

  async automationLoop() {
    this.log('Automation loop started.');
    let lastActionTimestamp = Date.now();
    // Watchdog: reload if stuck for 2+ minutes
    const watchdogInterval = setInterval(async () => {
      if (!this.isRunning) return clearInterval(watchdogInterval);
      if (Date.now() - lastActionTimestamp > 2 * 60 * 1000) {
        this.log('[WATCHDOG] No actions for 2+ minutes, reloading page and resuming.');
        try {
          await this.page.reload({ waitUntil: 'networkidle2' });
          await this.page.waitForSelector('[data-testid="tweet"]', { timeout: 15000 });
        } catch (e) {
          this.log('[WATCHDOG ERROR] Failed to reload page: ' + e);
        }
        lastActionTimestamp = Date.now();
      }
    }, 30000);
    while (this.isRunning) {
      try {
        this.actionsCount = 0; // Reset actions per cycle
        this.log('Automation loop tick.');
        // Check if we need to pause
        if (this.shouldPause()) {
          this.log('Taking a safety pause...');
          this.stats.lastPause = Date.now();
          await this.sleep(this.config.safety.pauseDuration);
          continue;
        }
        // Only check notifications every 15 minutes
        const now = Date.now();
        if (!this.lastNotificationCheck || (now - this.lastNotificationCheck) >= 15 * 60 * 1000) {
          this.log('Before checkNotifications');
          await this.checkNotifications();
          this.lastNotificationCheck = now;
          this.log('After checkNotifications');
        } else {
          this.log('Skipping notifications check (not 15 minutes yet)');
        }
        // Now interact with the main feed
        this.log('Before monitorFeed');
        await this.monitorFeed();
        this.log('After monitorFeed');
        // Random delay between actions
        await this.sleep(this.config.timing.actionDelay);
        // Update stats
        this.stats.interactions++;
        this.stats.dailyInteractions++;
        lastActionTimestamp = Date.now(); // Update watchdog timestamp
        // Reset daily stats at midnight
        if (new Date().getHours() === 0 && new Date().getMinutes() === 0) {
          this.stats.dailyInteractions = 0;
        }
        // Add a small delay before next cycle
        await this.sleep(5000);
      } catch (error) {
        this.log('Error in automation loop: ' + error);
        await this.sleep(5000); // Wait 5 seconds before retrying
      }
    }
    clearInterval(watchdogInterval);
  }

  shouldPause() {
    // Check if we've hit the daily interaction limit
    if (this.stats.dailyInteractions >= this.config.safety.maxDailyInteractions) {
      return true;
    }

    // Check if we need a pause after X interactions
    if (this.stats.interactions >= this.config.safety.pauseAfterInteractions) {
      if (!this.stats.lastPause || 
          (Date.now() - this.stats.lastPause) > this.config.safety.pauseDuration) {
        return true;
      }
    }

    return false;
  }

  async checkNotifications() {
    this.log('checkNotifications: start');
    try {
      this.log('Navigating to https://x.com/notifications for checkNotifications...');
      await this.page.goto('https://x.com/notifications', { waitUntil: 'networkidle2' });
      await this.page.waitForSelector('[data-testid="primaryColumn"]', { timeout: 15000 });
      this.log('checkNotifications: loaded notifications page');
      // Call checkReplies to process replies
      await this.checkReplies();
      this.log('checkNotifications: finished checkReplies');
    } catch (error) {
      this.log('Error checking notifications: ' + error);
    }
    this.log('checkNotifications: end');
  }

  async checkReplies() {
    this.log('checkReplies: start');
    if (this.actionsCount >= this.maxActionsPerCycle) return;
    try {
      // Only navigate to notifications if not already there
      const currentUrl = this.page.url();
      if (!currentUrl.includes('/notifications')) {
        this.log('Navigating to https://x.com/notifications for checkReplies...');
        await this.page.goto('https://x.com/notifications');
        await this.page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 });
      }
      // Simulate reading notifications
      await this.simulateHumanReading();
      const replies = await this.page.$$('[data-testid="tweet"]');
      // Get your username from the profile link (navigate away and back only as needed)
      let myUsername = null;
      if (!this._cachedUsername) {
        this.log('Navigating to https://x.com/home to get profile link...');
        await this.page.goto('https://x.com/home');
        await this.page.waitForSelector('[data-testid="AppTabBar_Profile_Link"]', { timeout: 15000 });
        const profileLink = await this.page.$('[data-testid="AppTabBar_Profile_Link"]');
        const href = await profileLink.evaluate(el => el.getAttribute('href'));
        myUsername = href.replace('/', '');
        this._cachedUsername = myUsername;
        // Go back to notifications
        this.log('Returning to notifications after getting username...');
        await this.page.goto('https://x.com/notifications');
        await this.page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 });
      } else {
        myUsername = this._cachedUsername;
      }
      for (const reply of replies) {
        if (this.actionsCount >= this.maxActionsPerCycle) break;
        // Check if this notification is a reply (has reply button and tweet text)
        let hasReplyButton = false;
        let hasTweetText = false;
        try {
          hasReplyButton = !!(await reply.$('[data-testid="reply"]'));
        } catch (e) {}
        try {
          hasTweetText = !!(await reply.$('[data-testid="tweetText"]'));
        } catch (e) {}
        if (!hasReplyButton || !hasTweetText) {
          this.log('Skipping non-reply notification (no reply button or tweet text).');
          continue;
        }
        // Get reply ID
        let replyId = null;
        let replyText = '';
        let likeButton = null;
        try {
          const linkEl = await reply.$('a[href*="/status/"]');
          const href = linkEl ? await linkEl.evaluate(el => el.getAttribute('href')) : '';
          replyId = href ? href.split('/status/')[1] : null;
        } catch (e) {}
        try {
          replyText = await reply.$eval('[data-testid="tweetText"]', el => el.textContent);
        } catch (e) {
          this.log('Could not extract reply text.');
          replyText = '';
        }
        try {
          likeButton = await reply.$('[data-testid="like"]');
        } catch (e) {
          this.log('Could not find like button.');
        }
        if (replyId && this.processedReplyIds.has(replyId)) {
          this.log('Skipping already processed reply: ' + replyId);
          continue;
        }
        // Scroll to the reply
        await this.humanLikeScroll();
        this.log('Found reply: ' + replyText);
        // Check for images in the reply
        const images = await reply.$$('img[alt="Image"]');
        for (const image of images) {
          await this.interactWithImage(image);
        }
        // Like the reply BEFORE navigating away
        if (likeButton) {
          this.log('Attempting to like reply: ' + replyText);
          await likeButton.click();
          this.emit('automation-accomplishment', `❤️ ${replyText}`);
          this.actionsCount++;
          await this.randomDelay(1000, 2000);
        } else {
          this.log('No like button found for reply: ' + replyText);
        }
        // Determine parent tweet's author and context (navigate only after like)
        let parentAuthor = null;
        let parentContext = '';
        try {
          const parentLink = await reply.$('a[href*="/status/"]');
          if (parentLink) {
            await parentLink.click();
            await this.page.waitForSelector('div[data-testid="User-Name"] span', { timeout: 10000 });
            const authorSpan = await this.page.$('div[data-testid="User-Name"] span');
            parentAuthor = authorSpan ? await authorSpan.evaluate(el => el.textContent.replace('@', '')) : null;
            // Get parent tweet text as context
            const parentTextEl = await this.page.$('[data-testid="tweetText"]');
            parentContext = parentTextEl ? await parentTextEl.evaluate(el => el.textContent) : '';
            await this.page.goBack();
            await this.page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 });
          }
        } catch (e) {
          this.log('Could not determine parent tweet author.');
        }
        // If reply is to your post, reply back using OpenAI
        if (myUsername && parentAuthor && parentAuthor === myUsername && this.config && this.config.openAIApiKey) {
          // Check cooldown period before replying
          if (!this.canReplyToUser(parentAuthor)) {
            this.log(`Skipping reply to @${parentAuthor} - cooldown period not elapsed`);
            continue;
          }

          const replyButton = await reply.$('[data-testid="reply"]');
          if (replyButton) {
            this.log('Generating AI reply...');
            const aiReply = await this.generateAIReply({
              apiKey: this.config.openAIApiKey,
              replyText,
              context: parentContext,
              tone: this.config.replyTone || 'Friendly',
              trainingData: store.get('trainingData') || {}
            });
            this.log('Replying to reply to my post: ' + aiReply);
            await replyButton.click();
            await this.page.waitForSelector('[data-testid="tweetTextarea_0"]');
            await this.safeType('[data-testid="tweetTextarea_0"]', aiReply);
            await this.safeClick('[data-testid="tweetButton"]');
            this.emit('automation-accomplishment', `Replied to: ${replyText}`);
            this.actionsCount++;
            // Update last reply time after successful reply
            this.updateLastReplyTime(parentAuthor);
            await this.randomDelay(15000, 30000);
          }
        }
        // Mark as processed
        if (replyId) {
          this.processedReplyIds.add(replyId);
          this.saveProcessedReplyIds();
        }
        // Skip if this is our own reply
        if (authorHandle && myUsername && authorHandle.toLowerCase() === myUsername.toLowerCase()) {
          this.log('Skipping own reply: ' + replyText);
          continue;
        }
      }
    } catch (error) {
      this.log('Error checking replies: ' + error);
    }
    this.log('checkReplies: end');
  }

  async processNotifications() {
    // Implementation of notification processing logic
    // This will be expanded based on specific requirements
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async stop() {
    if (!this.isRunning) {
      console.log('Automation not running');
      return false;
    }

    try {
      this.isRunning = false;
      console.log('Stopping automation...');
      
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
      }

      return true;
    } catch (error) {
      console.error('Failed to stop automation:', error);
      return false;
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async initialize() {
    try {
      console.log('Initializing automation...');
      
      this.browser = await puppeteer.launch({
        headless: false,
        userDataDir: path.join(process.env.HOME, '.reply-guy-profile'),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu'
        ]
      });
      
      this.page = await this.browser.newPage();
      
      // Set viewport size
      await this.page.setViewport({ width: 1280, height: 800 });
      
      // Add error handling
      this.page.on('error', err => {
        console.error('Page error:', err);
      });

      // Inject TensorFlow.js and MobileNet into the page
      await this.page.evaluate(async () => {
        // Load TensorFlow.js
        const tfScript = document.createElement('script');
        tfScript.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js';
        document.head.appendChild(tfScript);
        await new Promise(resolve => tfScript.onload = resolve);

        // Load MobileNet
        const mobilenetScript = document.createElement('script');
        mobilenetScript.src = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js';
        document.head.appendChild(mobilenetScript);
        await new Promise(resolve => mobilenetScript.onload = resolve);
      });

      // Check if we're logged in
      await this.ensureLoggedIn();

      console.log('Automation initialized successfully');
    } catch (error) {
      console.error('Initialization error:', error);
      throw error;
    }
  }

  async ensureLoggedIn() {
    try {
      console.log('Checking X login status...');
      await this.page.goto('https://x.com/home');
      // Check if we're on the login page
      const isLoginPage = await this.page.evaluate(() => {
        return window.location.href.includes('x.com/login') || window.location.href.includes('twitter.com/login');
      });
      if (isLoginPage) {
        console.log('Please log in to X in the browser window. Waiting for login...');
        // Wait for manual login
        await this.page.waitForFunction(() => {
          return !window.location.href.includes('x.com/login') && !window.location.href.includes('twitter.com/login');
        }, { timeout: 300000 }); // 5 minute timeout
        console.log('Login successful!');
      } else {
        console.log('Already logged in to X');
      }
    } catch (error) {
      console.error('Login check error:', error);
      throw error;
    }
  }

  async randomDelay(min = 3000, max = 8000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await this.sleep(delay);
  }

  async humanLikeScroll() {
    const scrollAmount = Math.floor(Math.random() * 300) + 100;
    await this.page.evaluate((amount) => {
      window.scrollBy(0, amount);
    }, scrollAmount);
    await this.randomDelay(1000, 3000);
  }

  async simulateHumanReading() {
    // Simulate reading time based on content length
    const content = await this.page.evaluate(() => {
      const tweets = document.querySelectorAll('[data-testid="tweetText"]');
      return Array.from(tweets).map(tweet => tweet.textContent).join(' ');
    });
    // Calculate reading time (rough estimate: 200 words per minute)
    const wordCount = content.split(/\s+/).length;
    // Reduce reading time to 0.5–1.5 seconds for speed
    const minTime = 500;
    const maxTime = 1500;
    await this.randomDelay(minTime, maxTime);
  }

  async safeClick(selector, timeout = 5000) {
    try {
      await this.page.waitForSelector(selector, { timeout });
      
      // Simulate human-like mouse movement
      const element = await this.page.$(selector);
      const box = await element.boundingBox();
      
      // Move mouse to element with slight randomness
      await this.page.mouse.move(
        box.x + box.width/2 + (Math.random() * 10 - 5),
        box.y + box.height/2 + (Math.random() * 10 - 5),
        { steps: 10 }
      );
      
      await this.randomDelay(500, 2000);
      await this.page.click(selector);
      return true;
    } catch (error) {
      console.error(`Failed to click ${selector}:`, error);
      return false;
    }
  }

  async safeType(selector, text, timeout = 5000) {
    try {
      await this.page.waitForSelector(selector, { timeout });
      await this.page.focus(selector);
      await this.sleep(500); // Increased delay to ensure focus is stable
      
      // Defensive: Only type if text is a valid string
      if (typeof text !== 'string' || !text.trim()) {
        this.log(`[SAFE TYPE ERROR] Invalid text: ${JSON.stringify(text)}`);
        return false;
      }

      // Clear any existing text first
      await this.page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (element) {
          element.value = '';
          element.textContent = '';
        }
      }, selector);

      // Wait for the clear to take effect
      await this.sleep(200);

      // Type the entire text at once with a small delay
      await this.page.type(selector, text, { delay: 50 });
      
      // Verify the text was typed correctly
      const enteredText = await this.page.$eval(selector, el => el.value || el.textContent).catch(() => '');
      if (!enteredText || !enteredText.includes(text.trim().slice(0, 10))) {
        this.log('[SAFE TYPE ERROR] Text verification failed. Retrying...');
        // Retry once with a different approach
        await this.page.evaluate((sel, txt) => {
          const element = document.querySelector(sel);
          if (element) {
            element.value = txt;
            element.textContent = txt;
            // Trigger input event to ensure React/other frameworks update
            element.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, selector, text);
        
        // Verify again
        const retryText = await this.page.$eval(selector, el => el.value || el.textContent).catch(() => '');
        if (!retryText || !retryText.includes(text.trim().slice(0, 10))) {
          this.log('[SAFE TYPE ERROR] Text verification failed after retry');
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error(`Failed to type in ${selector}:`, error);
      return false;
    }
  }

  async identifyImage(imageUrl) {
    try {
      // Download and process the image
      const response = await this.page.evaluate(async (url) => {
        const res = await fetch(url);
        const blob = await res.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      }, imageUrl);

      // Process image with sharp
      const base64Data = response.split(',')[1];
      const processedImage = await sharp(Buffer.from(base64Data, 'base64'))
        .resize(224, 224) // MobileNet input size
        .toBuffer();

      // Convert to base64 for browser processing
      const processedBase64 = `data:image/jpeg;base64,${processedImage.toString('base64')}`;

      // Use browser's TensorFlow.js for prediction
      const predictions = await this.page.evaluate(async (imageData) => {
        const model = await mobilenet.load();
        const img = new Image();
        img.src = imageData;
        await new Promise(resolve => img.onload = resolve);
        return await model.classify(img);
      }, processedBase64);

      return predictions;
    } catch (error) {
      console.error('Image identification error:', error);
      return null;
    }
  }

  async interactWithImage(imageElement) {
    try {
      // Get image URL
      const imageUrl = await imageElement.evaluate(img => img.src);
      
      // Identify image content
      const predictions = await this.identifyImage(imageUrl);
      
      if (predictions && predictions.length > 0) {
        console.log('Image contains:', predictions[0].className);
        
        // Click on the image
        await imageElement.click();
        
        // Wait for image modal
        await this.page.waitForSelector('[data-testid="modal"]', { timeout: 5000 });
        
        // Simulate looking at the image
        await this.randomDelay(5000, 15000);
        
        // Close the modal
        await this.page.keyboard.press('Escape');
      }
    } catch (error) {
      console.error('Error interacting with image:', error);
    }
  }

  async runAutomationCycle() {
    try {
      console.log('Starting automation cycle...');
      this.actionsCount = 0;
      
      // Add random initial delay (1-3 minutes)
      await this.randomDelay(60000, 180000);
      
      // 1. Check replies
      await this.checkReplies();
      
      // Add random delay between tasks (2-5 minutes)
      await this.randomDelay(120000, 300000);
      
      // 2. Monitor feed for GM posts
      await this.monitorFeed();
      
      // Add random delay between tasks (2-5 minutes)
      await this.randomDelay(120000, 300000);
      
      // 3. Find new accounts to follow
      await this.findNewAccounts();
      
      this.lastCheckTime = new Date();
      console.log('Automation cycle completed successfully');
    } catch (error) {
      console.error('Automation cycle error:', error);
      await this.recoverFromError();
    }
  }

  async recoverFromError() {
    try {
      // Refresh the page
      await this.page.reload({ waitUntil: 'networkidle0' });
      await this.randomDelay(2000, 5000);
      
      // Check if we're still logged in
      await this.ensureLoggedIn();
    } catch (error) {
      console.error('Error recovery failed:', error);
    }
  }

  log(message) {
    console.log('EMIT automation-log:', message);
    this.emit('automation-log', message);
  }

  async monitorFeed() {
    if (this.actionsCount >= this.maxActionsPerCycle) {
      this.log('monitorFeed: actionsCount already at max, skipping.');
      return;
    }
    try {
      // Only navigate to home if we're not already there
      const currentUrl = this.page.url();
      if (!currentUrl.includes('x.com/home') && !currentUrl.includes('twitter.com/home')) {
      this.log('Navigating to https://x.com/home for monitorFeed...');
      await this.page.goto('https://x.com/home');
      await this.page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 });
      } else {
        this.log('Already on home feed, continuing to scroll...');
      }
      
      // Initialize processed tweets set for this session (only for actually interacted tweets)
      if (!this.processedTweetIds) {
        this.processedTweetIds = new Set();
      }
      
      // CONTINUOUS SCROLL: Don't scroll at the beginning, just process current view
      // Only scroll if no good tweets are found
      
      const tweetElements = await this.page.$$('[data-testid="tweet"]');
      this.log(`monitorFeed: found ${tweetElements.length} tweets in current view.`);
      
      // Extract filter variables first
      const focusKeywords = (this.config && this.config.focusKeywords) || [];
      const skipKeywords = (this.config && this.config.skipKeywords) || [];
      const priorityUsers = (this.config && this.config.priorityUsers) || [];
      
      // Debug: Log current filters
      this.log(`[DEBUG] Current filters - Focus: ${focusKeywords.length} keywords, Skip: ${skipKeywords.length} keywords, Priority: ${priorityUsers.length} users`);
      const bearishUsers = this.getBearishUsers();
      
      let scoredTweets = [];
      let processableCount = 0;
      let totalProcessed = 0;
      
      // Process tweets but DON'T mark as processed until interaction
      for (const tweetElement of tweetElements) {
        try {
          totalProcessed++;
          const tweet = await this.extractTweetData(tweetElement);
          if (!tweet || !tweet.tweetId || !tweet.tweetText) {
            this.log(`[SKIP] Tweet ${totalProcessed}: No tweet data extracted`);
            continue;
          }
          
          // ONLY skip tweets we've actually interacted with (liked/replied)
          if (this.processedTweetIds.has(tweet.tweetId)) {
            this.log(`[SKIP] Tweet ${totalProcessed}: Already processed ${tweet.tweetId}`);
            continue; // Skip tweets we've already interacted with
          }
          
          // Get cached username for comparison
          if (!this._cachedUsername) {
            try {
              // Try to get username from current page
              const profileLinks = await this.page.$$('a[href^="/"][data-testid="AppTabBar_Profile_Link"], a[href^="/"][aria-label*="Profile"]');
              if (profileLinks.length > 0) {
                const href = await profileLinks[0].evaluate(el => el.getAttribute('href'));
                if (href && href.startsWith('/') && !href.includes('/status/')) {
                  this._cachedUsername = href.substring(1).toLowerCase(); // Remove leading slash and normalize
                }
              }
            } catch (e) {
              // Continue without cached username
            }
          }
          
          // Skip own tweets and replies
          if (tweet.author && this._cachedUsername) {
            const normalizedAuthor = tweet.author.toLowerCase().replace(/^@/, '');
            if (normalizedAuthor === this._cachedUsername) {
              this.log(`[SKIP] Tweet ${totalProcessed}: Own content by @${tweet.author}: ${tweet.tweetText.substring(0, 50)}...`);
          continue;
            }
          }
          
          // Skip replies to own tweets
          if (tweet.isReply && tweet.replyToUsername && this._cachedUsername) {
            const normalizedReplyTo = tweet.replyToUsername.toLowerCase().replace(/^@/, '');
            if (normalizedReplyTo === this._cachedUsername) {
              this.log(`[SKIP] Tweet ${totalProcessed}: Reply to own tweet by @${tweet.author}: ${tweet.tweetText.substring(0, 50)}...`);
          continue;
            }
          }
          
          processableCount++;
          
          // Score the tweet using the enhanced system
          const scoreResult = this.calculateTweetScore(tweet, {
            focusKeywords,
            skipKeywords, 
            priorityUsers,
            bearishUsers
          });
          
          // DEBUG: Log every tweet score for transparency
          this.log(`[TWEET SCORE] ${totalProcessed}. @${tweet.author}: ${tweet.tweetText.substring(0, 50)}... Score: ${scoreResult.score}, ShouldProcess: ${scoreResult.shouldProcess}, ShouldReply: ${scoreResult.shouldReply}, Reason: ${scoreResult.replyReason}`);
          
          if (scoreResult.shouldProcess) {
            scoredTweets.push({
              ...tweet,
              element: tweetElement,
              score: scoreResult.score,
              shouldReply: scoreResult.shouldReply,
              replyReason: scoreResult.replyReason,
              breakdown: scoreResult.breakdown,
              matchedKeywords: scoreResult.matchedKeywords || []
            });
          } else {
            this.log(`[FILTERED OUT] @${tweet.author}: ${scoreResult.replyReason}`);
          }
          
        } catch (error) {
          this.log(`[ERROR] Tweet ${totalProcessed}: ${error.message}`);
          continue; // Skip problematic tweets
        }
      }
      
      this.log(`monitorFeed: Processed ${totalProcessed} total tweets, ${processableCount} processable, ${scoredTweets.length} worth engaging with`);
      
      // Sort by score (highest first) and process top candidates
      scoredTweets.sort((a, b) => b.score - a.score);
      const topTweets = scoredTweets.slice(0, 5); // Process top 5 for better chances
      
      if (topTweets.length === 0) {
        this.log('monitorFeed: No good tweets found in current view, scrolling down for more content...');
        // PROPER INFINITE SCROLL: Scroll down to load more tweets
        await this.page.evaluate(() => {
          // Scroll down by multiple screen heights to trigger more content loading
          const scrollHeight = document.documentElement.scrollHeight;
          const currentScroll = window.scrollY;
          const newScrollPosition = currentScroll + (window.innerHeight * 3);
          window.scrollTo(0, Math.min(newScrollPosition, scrollHeight));
        });
        await this.sleep(2000); // Wait longer for new content to load
        return; // Try again in next cycle with new content
      }
      
      this.log(`monitorFeed: Processing ${topTweets.length} top candidates...`);
      
      for (const tweet of topTweets) {
        try {
          // Cooldown check
          const normalizedHandle = tweet.author.toLowerCase().replace(/^@/, '');
          if (!this.canReplyToUser(normalizedHandle)) {
            this.log(`[COOLDOWN] Skipping @${normalizedHandle} - too recent`);
              continue;
            }

          this.log(`monitorFeed: Processing tweet (score: ${tweet.score}) from @${tweet.author}: ${tweet.tweetText.substring(0, 100)}${tweet.tweetText.length > 100 ? '...' : ''}`);
          this.log(`monitorFeed: Score breakdown: ${Array.isArray(tweet.breakdown) ? tweet.breakdown.join(', ') : tweet.breakdown}`);
          
          // Try to interact (like) the tweet
          let interacted = false;
          try {
            const likeButton = await tweet.element.$('[data-testid="like"]');
            if (likeButton) {
              await likeButton.click();
              await this.sleep(300);
              this.log(`monitorFeed: ❤️ @${tweet.author}: ${tweet.tweetText}`);
              this.emit('automation-accomplishment', `❤️ Liked tweet by @${tweet.author}: ${tweet.tweetText}`);
              interacted = true;
              
              // MARK AS PROCESSED ONLY AFTER SUCCESSFUL INTERACTION
              this.processedTweetIds.add(tweet.tweetId);
            }
          } catch (error) {
            // Single attempt only - ignore like errors and continue
          }

          if (!interacted) {
            this.log(`monitorFeed: Could not interact with tweet ${tweet.tweetId}, skipping quickly.`);
            continue;
          }

          // Proceed with reply if warranted
          if (tweet.shouldReply && tweet.score >= 10) {
            await this.sleep(200);
            
            const profileBio = await this.getProfileBio(tweet.element);
            const enhancedContext = this.buildEnhancedContext(tweet, profileBio, tweet.replyReason);
            
            this.log(`[RAW TWEET TEXT] ${tweet.tweetText}`);
            this.log(`monitorFeed: Decided to reply (${tweet.replyReason}) to tweet: ${tweet.tweetText}`);
            
            const result = await this.generateAIReply({
              apiKey: this.config.openAIApiKey,
              replyText: tweet.tweetText,
              context: enhancedContext,
              tone: this.config.replyTone || 'Friendly',
              trainingData: null,
              keywordMatches: tweet.matchedKeywords,
              scoreBreakdown: tweet.breakdown
            });
            
            if (result.success && result.comment) {
              this.log(`monitorFeed: Generated AI comment: ${result.comment}`);
              
              const approvalData = {
                tweetText: tweet.tweetText,
                aiComment: result.comment,
                authorHandle: tweet.author,
                tweetId: tweet.tweetId
              };
              
              const approvalResult = await this.waitForCommentApproval(approvalData);
              
              if (approvalResult.approved && approvalResult.type === 'ACCEPT') {
                await this.postReplyWithImage(tweet.element, result.comment, approvalResult.image);
                this.actionsCount++;
                this.updateLastReplyTime(normalizedHandle);
                break; // Process only one reply per cycle
              } else if (approvalResult.approved && approvalResult.type === 'MANUAL_INPUT') {
                await this.handleManualInput(approvalResult);
                this.actionsCount++;
                this.updateLastReplyTime(normalizedHandle);
                break;
              } else {
                this.log('monitorFeed: Comment rejected by user.');
              }
            } else {
              this.log(`monitorFeed: Skipping reply for tweet: ${tweet.tweetText.substring(0, 100)}${tweet.tweetText.length > 100 ? '...' : ''}`);
            }
          }
          
        } catch (error) {
          this.log(`monitorFeed: Error processing tweet: ${error.message}`);
          continue;
        }
      }
      
      // Keep processed tweet set manageable (only recent interactions)
      if (this.processedTweetIds.size > 100) {
        const tweetArray = Array.from(this.processedTweetIds);
        this.processedTweetIds = new Set(tweetArray.slice(-50)); // Keep last 50 interactions only
      }
      
    } catch (error) {
      this.log(`monitorFeed: Error - ${error.message}`);
    }
  }

  // New method: Calculate sophisticated tweet score
  calculateTweetScore(tweet, filters) {
    const { focusKeywords, skipKeywords, priorityUsers, bearishUsers } = filters;
    const tweetText = tweet.tweetText.toLowerCase();
    let score = 0;
    let shouldProcess = true; // Default to processing tweets
        let shouldReply = false;
        let replyReason = '';
    let breakdown = [];
    let matchedKeywords = [];

    // HARD BLOCKS - Skip immediately if these conditions are met
    
    // 1. Skip keywords (absolute dealbreaker)
    const skipMatches = skipKeywords.filter(kw => {
      const keyword = kw.toLowerCase();
      return tweetText.includes(keyword);
    });
    
    if (skipMatches.length > 0) {
      this.log(`[SKIP KEYWORD BLOCK] Tweet contains skip keyword(s): ${skipMatches.join(', ')}`);
      return {
        score: -1000,
        shouldProcess: false,
        shouldReply: false,
        replyReason: `Contains skip keyword(s): ${skipMatches.join(', ')}`,
        breakdown: ['BLOCKED by skip keywords'],
        matchedKeywords: [],
        isPriorityUser: false
      };
    }

    // 2. Promoted/sponsored tweet detection (enhanced)
    // First check if it's marked as promoted in the UI
    if (tweet.isPromoted) {
      this.log(`[AD BLOCK] Tweet is marked as promoted/sponsored in UI`);
      return {
        score: -1000,
        shouldProcess: false,
        shouldReply: false,
        replyReason: 'Promoted/sponsored tweet (UI detected)',
        breakdown: ['BLOCKED by promoted tweet detection'],
        matchedKeywords: [],
        isPriorityUser: false
      };
    }
    
    // Secondary check: Content-based sponsored detection
    const originalTweetText = tweet.tweetText; // Keep original for case-sensitive checks
    const sponsoredIndicators = [
      'promoted', 'sponsored', 'ad ', ' ad', 'advertisement',
      'twclid=', 'utm_', 'promo code', 'discount code',
      'buy now', 'shop now', 'limited time', 'act now',
      'click here', 'link in bio'
    ];
    
    const isSponsoredTweet = sponsoredIndicators.some(indicator => 
      originalTweetText.toLowerCase().includes(indicator.toLowerCase())
    );
    
    if (isSponsoredTweet) {
      this.log(`[SPONSORED BLOCK] Tweet appears to be sponsored/promotional (content-based)`);
      return {
        score: -500,
        shouldProcess: false,
        shouldReply: false,
        replyReason: 'Sponsored/promotional tweet (content detected)',
        breakdown: ['BLOCKED by sponsored content detection'],
        matchedKeywords: [],
        isPriorityUser: false
      };
    }

    // 3. Check if it's a priority user (this overrides most restrictions)
    const normalizedAuthor = tweet.author ? tweet.author.toLowerCase().replace(/^@/, '') : '';
    const isPriorityUser = priorityUsers.some(user => 
      user.toLowerCase() === normalizedAuthor
    );

    // PRIORITY FACTORS - These guarantee replies
    
    // 1. Priority users (highest priority)
    if (isPriorityUser) {
      score += 1000;
          shouldReply = true;
          replyReason = 'Priority user';
      breakdown.push('Priority user (+1000)');
    }

    // 2. Focus keywords (weighted by relevance and position)
    if (focusKeywords.length > 0) {
      focusKeywords.forEach(keyword => {
        const kw = keyword.toLowerCase();
        if (tweetText.includes(kw)) {
          matchedKeywords.push(keyword);
          
          // Higher score for exact word matches vs partial matches
          const wordBoundaryMatch = new RegExp(`\\b${kw}\\b`).test(tweetText);
          const keywordScore = wordBoundaryMatch ? 200 : 100;
          
          // Bonus for multiple occurrences
          const occurrences = (tweetText.match(new RegExp(kw, 'g')) || []).length;
          const finalKeywordScore = keywordScore * Math.min(occurrences, 3); // Cap at 3x multiplier
          
          score += finalKeywordScore;
          breakdown.push(`Keyword "${keyword}" (+${finalKeywordScore})`);
          
          if (!shouldReply) {
          shouldReply = true;
            replyReason = `Contains focus keyword(s): ${matchedKeywords.join(', ')}`;
          }
        }
      });
    }

    // CONTEXTUAL FACTORS - These increase reply likelihood
    
    // 3. GM detection (time-sensitive greeting)
    const isGM = /\b(gm|GM|Gm|good morning)\b/.test(originalTweetText);
    if (isGM) {
      const currentHour = new Date().getHours();
      // More points for GM tweets in actual morning hours
      const timeBonus = (currentHour >= 6 && currentHour <= 12) ? 150 : 75;
      score += timeBonus;
      breakdown.push(`GM detected (+${timeBonus})`);
      if (!shouldReply) {
            shouldReply = true;
        replyReason = 'GM greeting detected';
      }
    }

    // 4. Question detection (engagement opportunity)
    const isQuestion = originalTweetText.includes('?') || /^(who|what|when|where|why|how)\b/i.test(originalTweetText.trim());
    if (isQuestion) {
      score += 100;
      breakdown.push('Question detected (+100)');
      if (!shouldReply) {
          shouldReply = true;
          replyReason = 'Question detected';
        }
    }

    // 5. Content quality indicators
    const tweetLength = originalTweetText.length;
    if (tweetLength > 20 && tweetLength < 300) { // More generous length requirements
      score += 25;
      breakdown.push('Good length (+25)');
    }

    // 6. Conversation starters (words that indicate discussion)
    const conversationWords = ['think', 'opinion', 'thoughts', 'agree', 'disagree', 'anyone', 'everybody', 'community'];
    const conversationMatches = conversationWords.filter(word => tweetText.includes(word));
    if (conversationMatches.length > 0) {
      const conversationScore = conversationMatches.length * 30;
      score += conversationScore;
      breakdown.push(`Conversation indicators (+${conversationScore})`);
    }

    // 7. Sentiment-based bonus (catch more positive/interesting content)
    const positiveWords = ['love', 'great', 'amazing', 'awesome', 'excited', 'happy', 'good', 'nice', 'cool', 'thanks', 'appreciate'];
    const positiveMatches = positiveWords.filter(word => tweetText.includes(word));
    if (positiveMatches.length > 0) {
      score += positiveMatches.length * 15;
      breakdown.push(`Positive sentiment (+${positiveMatches.length * 15})`);
    }

    // 8. Crypto/tech keywords (broader engagement)
    const cryptoTechWords = ['crypto', 'bitcoin', 'eth', 'blockchain', 'nft', 'defi', 'web3', 'ai', 'tech', 'build', 'dev', 'code'];
    const cryptoMatches = cryptoTechWords.filter(word => tweetText.includes(word));
    if (cryptoMatches.length > 0) {
      score += cryptoMatches.length * 20;
      breakdown.push(`Crypto/tech content (+${cryptoMatches.length * 20})`);
    }

    // 9. Social engagement words (community building)
    const socialWords = ['community', 'together', 'team', 'frens', 'gm', 'gn', 'family', 'group', 'join', 'welcome'];
    const socialMatches = socialWords.filter(word => tweetText.includes(word));
    if (socialMatches.length > 0) {
      score += socialMatches.length * 15;
      breakdown.push(`Social engagement (+${socialMatches.length * 15})`);
    }

    // 10. Achievement/milestone posts (celebration opportunities)
    const achievementWords = ['milestone', 'achievement', 'launched', 'completed', 'won', 'success', 'reached', 'hit'];
    const achievementMatches = achievementWords.filter(word => tweetText.includes(word));
    if (achievementMatches.length > 0) {
      score += achievementMatches.length * 25;
      breakdown.push(`Achievement content (+${achievementMatches.length * 25})`);
    }

    // 11. Shorter tweets get a small bonus (easier to engage with)
    if (tweetLength < 100) {
      score += 15;
      breakdown.push('Short tweet bonus (+15)');
    }

    // 12. Tweet type preferences (prefer main tweets over replies)
    if (tweet.isReply) {
      // Reduce score for replies to focus on main tweets
      score -= 50;
      breakdown.push('Reply penalty (-50)');
      
      // But give some points back for replies to priority users
      if (tweet.replyToUsername && priorityUsers.some(user => 
        user.toLowerCase() === tweet.replyToUsername.toLowerCase().replace(/^@/, ''))) {
        score += 25;
        breakdown.push('Reply to priority user (+25)');
      }
    } else {
      // Bonus for main tweets (original posts)
      score += 25;
      breakdown.push('Main tweet bonus (+25)');
    }

    // 13. BASIC ENGAGEMENT BONUS: Give points just for being a regular tweet
    if (tweetLength > 5) { // Any tweet with substance gets some base points
      score += 10;
      breakdown.push('Basic tweet bonus (+10)');
    }

    // NEGATIVE FACTORS - These reduce reply likelihood but don't block processing
    
    // 1. Spam indicators (but don't block completely)
    const spamWords = ['follow me', 'check out', 'dm me', 'subscribe'];
    const spamMatches = spamWords.filter(word => tweetText.includes(word));
    if (spamMatches.length > 0) {
      score -= spamMatches.length * 30; // Reduced penalty
      breakdown.push(`Spam indicators (-${spamMatches.length * 30})`);
    }

    // 2. Overly promotional content (reduced penalty)
    if (tweetText.includes('$') && tweetText.includes('buy')) {
      score -= 25; // Reduced from 75
      breakdown.push('Promotional content (-25)');
    }

    // 3. Negative sentiment that's too aggressive (reduced penalty)
    const aggressiveWords = ['hate', 'stupid', 'idiot', 'scam', 'rug'];
    const aggressiveMatches = aggressiveWords.filter(word => tweetText.includes(word));
    if (aggressiveMatches.length > 0) {
      score -= aggressiveMatches.length * 50; // Reduced from 100
      breakdown.push(`Aggressive language (-${aggressiveMatches.length * 50})`);
    }

    // MINIMUM THRESHOLDS (much more generous)
    
    // Set minimum score threshold for replies (VERY LOW for more activity)
    const minScoreForReply = isPriorityUser ? 0 : 10; // Reduced from 25 to 10
    if (score >= minScoreForReply || isPriorityUser) {
      shouldReply = true;
      if (!replyReason) {
        replyReason = `Score sufficient (${score} >= ${minScoreForReply})`;
      }
    }

    return {
      score: score,
      shouldProcess: shouldProcess, // Almost always true now
      shouldReply: shouldReply,
      replyReason: replyReason,
      breakdown: breakdown.length > 0 ? breakdown : ['No scoring factors'],
      matchedKeywords: matchedKeywords,
      isPriorityUser: isPriorityUser
    };
  }

  // New method: Build enhanced context for AI generation
  buildEnhancedContext(tweet, profileBio, replyReason) {
    const context = [
      `Tweet content: "${tweet.tweetText}"`,
      `Author: @${tweet.author}`,
      `Reply reason: ${replyReason}`
    ];
    
    if (profileBio && profileBio.length > 0) {
      context.push(`Author bio: ${profileBio}`);
    }
    
    return context.join('\n');
  }

  async getProfileBio(tweetElement) {
    try {
      // Try to find profile bio in the tweet element or nearby
      // This is a simple implementation - could be enhanced
      return ''; // Return empty for now since profile bio extraction is complex
    } catch (error) {
      return '';
    }
  }

  waitForCommentApproval({ tweetText, aiComment, authorHandle, tweetId }) {
    return new Promise((resolve) => {
      const normHandle = this.normalizeHandle(authorHandle);
      this.log(`[DEBUG APPROVAL] Original authorHandle: ${authorHandle}, normalized: ${normHandle}`);
      this.emit('automation-comment-approval', { 
        tweetText, 
        aiComment,
        authorHandle: normHandle,
        tweetId,
        options: ['ACCEPT', 'RE-GENERATE', 'MANUAL INPUT']
      });
      this.once('automation-comment-approval-response', async (response) => {
        this.log(`[DEBUG APPROVAL] Response received:`, response);
        this.log(`[DEBUG APPROVAL] Response authorHandle: ${response.authorHandle}, original authorHandle: ${authorHandle}`);
        const cooldownKey = this.normalizeHandle(response.authorHandle);
        if (!cooldownKey) {
          this.log('[COOLDOWN WARNING] authorHandle missing or invalid in approval response. Cooldown will not work.');
        }
        if (response.type === 'MANUAL_INPUT') {
          // Call handleManualInput to process and post the manual reply
          try {
            this.log(`[DEBUG MANUAL] Calling handleManualInput with authorHandle: ${normHandle} (normalized) vs ${authorHandle} (original)`);
            const success = await this.handleManualInput({
              comment: response.comment,
              image: response.image,
              tweetId: tweetId,
              authorHandle: normHandle // Use normalized authorHandle, same as what was sent to frontend
            });
            
            if (success) {
              this.emit('automation-accomplishment', `Manual reply posted with ${response.image ? 'image' : 'no image'}: ${response.comment}`);
              this.log('[MANUAL INPUT] Manual input handled successfully, returning to feed...');
            } else {
              this.log('[MANUAL INPUT] Manual input processing failed');
            }
          } catch (error) {
            this.log('[MANUAL INPUT ERROR] Error processing manual input: ' + error.message);
          }
          
          // Add cooldown update here
          this.updateLastReplyTime(cooldownKey);
          
          // IMPORTANT: Resolve the promise to continue automation
          this.log('[MANUAL INPUT] Resuming automation after manual input...');
          resolve(response);
        } else if (response.type === 'ACCEPT') {
          // Post the reply using the provided aiComment and image
          try {
            if (!this.browser || !this.page) throw new Error('Browser not initialized');
            // Re-select the tweet by tweetId before posting
            let tweetEl = null;
            let tweetContainer = null;
            
            // STEP 1: Try to find by tweet ID first (most reliable)
            if (response.tweetId) {
              this.log(`[POST REPLY] Searching for specific tweet ID: ${response.tweetId}`);
              
              // Try multiple methods to find the tweet by ID
              const tweetSelectors = [
                `a[href*="/status/${response.tweetId}"]`,
                `[data-testid="tweet"] a[href*="/status/${response.tweetId}"]`,
                `article a[href*="/status/${response.tweetId}"]`
              ];
              
              for (const selector of tweetSelectors) {
                try {
                  tweetEl = await this.page.$(selector);
                  if (tweetEl) {
                    this.log(`[POST REPLY] Found tweet by ID using selector: ${selector}`);
                    tweetContainer = await tweetEl.evaluateHandle(el => el.closest('[data-testid="tweet"]'));
                    if (tweetContainer) {
                      this.log(`[POST REPLY] Successfully found tweet container for ID: ${response.tweetId}`);
                      break;
                    }
                  }
                } catch (e) { continue; }
              }
              
              // If not found on current page, try navigating to the specific tweet
              if (!tweetContainer) {
                this.log(`[POST REPLY] Tweet ${response.tweetId} not found on current page, trying direct navigation...`);
                try {
                  const tweetUrl = `https://x.com/${response.authorHandle}/status/${response.tweetId}`;
                  await this.page.goto(tweetUrl, { waitUntil: 'networkidle2', timeout: 15000 });
                  await this.sleep(2000);
                  
                  tweetContainer = await this.page.$('[data-testid="tweet"]');
                  if (tweetContainer) {
                    this.log(`[POST REPLY] Found tweet via direct URL navigation: ${tweetUrl}`);
                  }
                } catch (error) {
                  this.log(`[POST REPLY] Direct URL navigation failed: ${error.message}`);
                }
              }
            }
            
            // STEP 2: Fallback to original method only if tweet ID search failed
            if (!tweetContainer) {
              this.log(`[POST REPLY WARNING] Could not find tweet by ID, falling back to generic search`);
              tweetEl = await this.page.$('[data-testid="tweet"]');
              if (tweetEl) {
                tweetContainer = tweetEl;
              }
            }
            
            if (!tweetContainer) {
              this.log(`[POST REPLY ERROR] Could not find any tweet container for posting reply.`);
              resolve(response);
              return;
            }
            
            // Extract tweet text from the FOUND tweet container to verify it's correct
            let domTweetText = '';
            try {
              const tweetTextEl = await tweetContainer.$('[data-testid="tweetText"]');
              if (tweetTextEl) {
                domTweetText = await tweetTextEl.evaluate(el => el.textContent);
                this.log(`[POST REPLY] Found tweet text from target container: "${domTweetText.slice(0, 100)}..."`);
              } else {
                this.log(`[POST REPLY WARNING] Could not extract tweet text from container`);
              }
            } catch (e) {
              this.log(`[POST REPLY WARNING] Error extracting tweet text: ${e.message}`);
            }
            
            // Compare texts more leniently - normalize whitespace and allow partial matches
            const skipKeywords = (this.config && this.config.skipKeywords) || [];
            const normalizedDom = domTweetText.replace(/\s+/g, ' ').trim().toLowerCase();
            const normalizedApproved = response.tweetText.replace(/\s+/g, ' ').trim().toLowerCase();
            
            // Allow reply if we couldn't extract text OR if texts match (exactly or first 50 chars match)
            const textMatches = !domTweetText || 
                               normalizedDom === normalizedApproved || 
                               normalizedDom.startsWith(normalizedApproved.slice(0, 50)) ||
                               normalizedApproved.startsWith(normalizedDom.slice(0, 50));
            
            if (!textMatches) {
              this.log(`[POST REPLY WARNING] Tweet text mismatch, but continuing anyway.\nDOM: ${domTweetText.slice(0, 100)}...\nApproved: ${response.tweetText.slice(0, 100)}...`);
              // Continue anyway - the mismatch might be due to navigation context changes
            }
            
            if (skipKeywords.some(kw => domTweetText.toLowerCase().includes(kw.toLowerCase()))) {
              this.log('[POST REPLY ERROR] Tweet contains skip keyword. Skipping reply.');
              resolve(response);
              return;
            }
            
            const imagePath = response.image ? path.join(process.cwd(), 'artwork', response.image) : null;
            // Always use the aiComment from the approval response
            await this.postReplyWithImage(tweetContainer, response.aiComment, imagePath);
            this.emit('automation-accomplishment', `Replied with image: ${response.image}`);
          } catch (error) {
            this.log('Error posting reply with image: ' + error);
          }
          resolve(response);
          // Add cooldown update here
          this.updateLastReplyTime(cooldownKey);
        } else if (response.type === 'RE-GENERATE') {
          // Simplified re-generation - just generate new AI reply and re-emit approval
          try {
            this.log('[RE-GENERATE] Generating new AI reply...');
            
            // Use the provided tone and context, or fallback to current config
            const effectiveTone = response.tone || this.config?.replyTone || 'Friendly';
            const apiKey = this.config?.openAIApiKey;
            
            if (!apiKey) {
              this.log('[RE-GENERATE ERROR] No OpenAI API key available');
              resolve({ type: 'SKIP', authorHandle: response.authorHandle });
              return;
            }
            
            // Generate new AI reply
            const regenResult = await this.generateAIReply({
              apiKey: apiKey,
              replyText: response.tweetText || tweetText,
              context: response.context || '',
              tone: effectiveTone,
              trainingData: this.trainingData || [],
              keywordMatches: [], 
              scoreBreakdown: null
            });
            
            if (regenResult && regenResult.success) {
              this.log(`[RE-GENERATE] New AI comment: ${regenResult.comment}`);
              
              // Get random image from the selected folder
              let randomImage = null;
              if (response.image) {
                // Use the provided image
                randomImage = response.image;
              } else {
                // Try to get a random image from available folders
                try {
                  const imageFolders = ['pengztracted']; // Default folder
                  const selectedFolder = imageFolders[0];
                  const artworkPath = path.join(process.cwd(), 'artwork', selectedFolder);
                  
                  if (fs.existsSync(artworkPath)) {
                    const files = fs.readdirSync(artworkPath).filter(file => 
                      /\.(jpg|jpeg|png|gif|webp)$/i.test(file)
                    );
                    
                    if (files.length > 0) {
                      const randomIndex = Math.floor(Math.random() * files.length);
                      randomImage = `${selectedFolder}/${files[randomIndex]}`;
                    }
                  }
                } catch (e) {
                  this.log(`[RE-GENERATE] Could not get random image: ${e.message}`);
                }
              }
              
              this.log(`[RE-GENERATE] Selected image: ${randomImage || 'none'}`);
              
              // Re-emit the approval event with new AI comment and image
              this.emit('automation-comment-approval', { 
                tweetText: response.tweetText || tweetText, 
                aiComment: regenResult.comment,
                authorHandle: response.authorHandle || normHandle,
                tweetId: response.tweetId || tweetId,
                image: randomImage,
                options: ['ACCEPT', 'RE-GENERATE', 'MANUAL INPUT']
              });
              
              // Don't resolve yet - wait for the new response
              return;
              
            } else {
              this.log('[RE-GENERATE ERROR] Failed to generate new AI comment');
              resolve({ type: 'SKIP', authorHandle: response.authorHandle });
            }
            
          } catch (error) {
            this.log(`[RE-GENERATE ERROR] Error during regeneration: ${error.message}`);
            resolve({ type: 'SKIP', authorHandle: response.authorHandle });
          }
        } else if (response.type === 'SKIP') {
          // Always navigate back to Home feed after skip
          try {
            await this.page.goto('https://x.com/home');
            await this.page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 });
            this.log('Navigated back to Home feed after skip.');
          } catch (error) {
            this.log('Error navigating back to Home feed after skip: ' + error);
          }
          resolve(response);
        } else {
          resolve(response);
        }
      });
    });
  }

  handleCommentRating(data) {
    try {
      const { comment, rating } = data;
      const trainingData = store.get('trainingData') || { commentRatings: [] };
      
      // Add the rating to training data
      trainingData.commentRatings = trainingData.commentRatings || [];
      trainingData.commentRatings.push({
        comment,
        rating,
        timestamp: new Date().toISOString()
      });
      
      // Save updated training data
      store.set('trainingData', trainingData);
      
      // Emit learning accomplishment
      this.emit('automation-accomplishment', 
        `Learning from reply: ${rating >= 4 ? 'Excellent' : rating >= 3 ? 'Good' : 'Needs improvement'} response rated`
      );
      
      // Update style patterns if rating is high
      if (rating >= 4) {
        this.emit('automation-accomplishment', 
          'Style pattern updated: Incorporating highly-rated response patterns'
        );
      }
      
      return true;
    } catch (error) {
      console.error('Error handling comment rating:', error);
      return false;
    }
  }

  async handleManualInput(data) {
    try {
      const { comment, image, tweetId, authorHandle } = data;
      this.log('[MANUAL INPUT] Starting manual input processing...');
      this.log(`[MANUAL INPUT] Need to find specific tweet ${tweetId} by @${authorHandle}`);
      
      // Store manual input for learning
      const trainingData = store.get('trainingData') || { manualInputs: [] };
      trainingData.manualInputs = trainingData.manualInputs || [];
      trainingData.manualInputs.push({
        comment,
        image,
        timestamp: new Date().toISOString(),
        manualComment: comment
      });
      store.set('trainingData', trainingData);
      this.emit('automation-accomplishment', 'Learning from manual input: Analyzing new writing style patterns');

      // Update style patterns for next AI reply
      const manualInputs = trainingData.manualInputs || [];
      const recentManualInputs = manualInputs.slice(-10);
      if (recentManualInputs.length > 0) {
        const keyPhrases = extractKeyPhrases(recentManualInputs);
        trainingData.userKeyPhrases = keyPhrases;
        store.set('trainingData', trainingData);
        this.log(`[MANUAL INPUT] Updated style patterns with ${keyPhrases.length} key phrases from manual inputs`);
      }

      // STEP 1: Navigate to the specific tweet URL if tweetId is provided
      let tweetContainer = null;
      
      if (tweetId) {
        try {
          // Try to navigate directly to the tweet
          const tweetUrl = `https://x.com/${authorHandle}/status/${tweetId}`;
          this.log(`[MANUAL INPUT] Attempting to navigate directly to tweet: ${tweetUrl}`);
          
          await this.page.goto(tweetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          await this.sleep(2000);
          
          // Look for the main tweet on the page
          const mainTweet = await this.page.$('[data-testid="tweet"]');
          if (mainTweet) {
            this.log('[MANUAL INPUT] Found specific tweet via direct URL navigation!');
            tweetContainer = mainTweet;
          }
        } catch (error) {
          this.log(`[MANUAL INPUT] Direct URL navigation failed: ${error.message}, falling back to feed search...`);
        }
      }
      
      // STEP 2: If direct navigation failed, search in home feed
      if (!tweetContainer) {
        this.log('[MANUAL INPUT] Searching for tweet in home feed...');
        await this.page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 30000 });
        await this.sleep(2000);

        // Search for the specific tweet
        let attempts = 0;
        const maxAttempts = 3;
        
        while (!tweetContainer && attempts < maxAttempts) {
          attempts++;
          this.log(`[MANUAL INPUT] Feed search attempt ${attempts}/${maxAttempts}...`);
          
          // Wait for tweets to load
          await this.page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 });
          await this.sleep(1000);
          
          // Find all tweet containers
          const tweets = await this.page.$$('[data-testid="tweet"]');
          this.log(`[MANUAL INPUT] Found ${tweets.length} tweets in feed`);
          
          for (let i = 0; i < tweets.length; i++) {
            try {
              const tweet = tweets[i];
              
              // First check if this tweet contains the tweetId (if available)
              if (tweetId) {
                try {
                  const tweetLink = await tweet.$('a[href*="/status/"]');
                  if (tweetLink) {
                    const href = await tweetLink.evaluate(el => el.getAttribute('href'));
                    if (href && href.includes(`/status/${tweetId}`)) {
                      this.log(`[MANUAL INPUT] Found specific tweet by ID match: ${tweetId}`);
                      tweetContainer = tweet;
                      break;
                    }
                  }
                } catch (e) { /* continue to other checks */ }
              }
              
              // Get the author handle from the tweet - try multiple methods
              let tweetAuthor = null;
              
              // Method 1: Standard User-Name selector
              try {
                tweetAuthor = await tweet.$eval('[data-testid="User-Name"] a', el => {
                  const href = el.getAttribute('href');
                  return href ? href.replace('/', '').toLowerCase() : null;
                });
              } catch (e) { /* fallback to next method */ }
              
              // Method 2: Any link that looks like a profile link
              if (!tweetAuthor) {
                try {
                  tweetAuthor = await tweet.evaluate(el => {
                    const links = el.querySelectorAll('a[href*="/"]');
                    for (const link of links) {
                      const href = link.getAttribute('href');
                      if (href && href.startsWith('/') && !href.includes('/status/') && 
                          !href.includes('/photo/') && !href.includes('?') && !href.includes('#')) {
                        const handle = href.replace('/', '').toLowerCase();
                        // Make sure it looks like a username (not too long, no spaces)
                        if (handle.length > 0 && handle.length < 30 && !handle.includes(' ')) {
                          return handle;
                        }
                      }
                    }
                    return null;
                  });
                } catch (e) { /* fallback to next method */ }
              }
              
              // Method 3: Look for @username patterns in the tweet text
              if (!tweetAuthor) {
                try {
                  tweetAuthor = await tweet.evaluate(el => {
                    const text = el.textContent || '';
                    // Look for @username at the beginning of the tweet
                    const match = text.match(/@([a-zA-Z0-9_]+)/);
                    return match ? match[1].toLowerCase() : null;
                  });
                } catch (e) { /* continue */ }
              }
              
              if (tweetAuthor && tweetAuthor === authorHandle.toLowerCase()) {
                this.log(`[MANUAL INPUT] Found tweet by @${authorHandle} (author match)!`);
                tweetContainer = tweet;
                break;
              }
            } catch (error) {
              continue; // Skip this tweet if we can't analyze it
            }
          }
          
          if (!tweetContainer && attempts < maxAttempts) {
            this.log('[MANUAL INPUT] Tweet not found, scrolling down...');
            await this.page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await this.sleep(1500);
          }
        }
      }
      
      if (!tweetContainer) {
        this.log('[MANUAL INPUT ERROR] Could not find the tweet to reply to');
        return false;
      }

      // STEP 3: Open the reply modal using the tweet container
      this.log('[MANUAL INPUT] Opening reply modal...');
      
      // Find and click the reply button within this tweet
      const replyButton = await tweetContainer.$('button[data-testid="reply"]');
      if (!replyButton) {
        this.log('[MANUAL INPUT ERROR] Could not find reply button on tweet');
        return false;
      }
      
      await replyButton.click();
      this.log('[MANUAL INPUT] Clicked reply button, waiting for modal...');
      
      // Wait for the reply modal to appear
      await this.page.waitForSelector('[role="dialog"]', { timeout: 10000 });
      await this.sleep(1000);
      
      // Verify we have the modal
      const modal = await this.page.$('[role="dialog"]');
      if (!modal) {
        this.log('[MANUAL INPUT ERROR] Reply modal did not appear');
        return false;
      }
      
      this.log('[MANUAL INPUT] Reply modal opened successfully!');

      // STEP 4: Attach image within the modal (if provided)
      if (image) {
        try {
          const imagePath = path.join(process.cwd(), 'artwork', image);
          this.log(`[MANUAL INPUT] Attaching image within modal: ${imagePath}`);
          
          const imageAttached = await this.attachImageToModal(modal, imagePath);
          
          if (imageAttached) {
            this.log('[MANUAL INPUT] Image successfully attached within modal');
            await this.sleep(2000); // Wait for image processing
          } else {
            this.log('[MANUAL INPUT WARNING] Image attachment failed, continuing with text only');
          }
        } catch (error) {
          this.log(`[MANUAL INPUT] Image attachment error: ${error.message}`);
        }
      }

      // STEP 5: Clear and type the manual text within the modal
      this.log('[MANUAL INPUT] Typing manual text within modal...');
      
      // Find textarea within the modal
      let replyArea = null;
      const textareaSelectors = [
        '[data-testid="tweetTextarea_0"]',
        'div[role="textbox"]',
        'div[contenteditable="true"]'
      ];

      for (const selector of textareaSelectors) {
        try {
          replyArea = await modal.$(selector);
          if (replyArea) {
            this.log(`[MANUAL INPUT] Found textarea within modal: ${selector}`);
            break;
          }
        } catch (e) { continue; }
      }
      
      if (!replyArea) {
        this.log('[MANUAL INPUT ERROR] Could not find textarea within modal');
        return false;
      }

      // Clear existing content and type new text
      await replyArea.evaluate(el => { 
        el.value = ''; 
        el.textContent = ''; 
        if (el.innerHTML !== undefined) el.innerHTML = '';
        el.dispatchEvent(new Event('input', { bubbles: true })); 
      });
      await this.sleep(300);
      
      // Focus and type
      await replyArea.click();
      await this.sleep(200);
      
      let textTyped = false;
      
      // Method 1: Direct typing
      try {
        await replyArea.type(comment, { delay: 30 });
        textTyped = true;
        this.log('[MANUAL INPUT] Manual text typed successfully using direct typing');
        } catch (error) {
        this.log('[MANUAL INPUT WARNING] Direct typing failed, trying JS...');
      }
      
      // Method 2: JavaScript injection (fallback)
      if (!textTyped) {
        try {
          await replyArea.evaluate((el, text) => { 
            el.value = text; 
            el.textContent = text; 
            if (el.innerHTML !== undefined) el.innerHTML = text;
            el.dispatchEvent(new Event('input', { bubbles: true })); 
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, comment);
          textTyped = true;
          this.log('[MANUAL INPUT] Manual text typed successfully using JS injection');
        } catch (error) {
          this.log('[MANUAL INPUT WARNING] JS typing failed, trying keyboard...');
        }
      }
      
      // Method 3: Keyboard typing (last resort)
      if (!textTyped) {
        try {
          await replyArea.click();
          await this.page.keyboard.selectAll();
          await this.page.keyboard.press('Delete');
          await this.page.keyboard.type(comment, { delay: 30 });
          textTyped = true;
          this.log('[MANUAL INPUT] Manual text typed successfully using keyboard');
        } catch (error) {
          this.log('[MANUAL INPUT ERROR] All typing methods failed for manual input');
        }
      }

      if (!textTyped) {
        this.log('[MANUAL INPUT ERROR] Could not type manual text - aborting');
        return false;
      }

      await this.sleep(1000);

      // STEP 6: Submit the reply within the modal
      this.log('[MANUAL INPUT] Submitting manual reply within modal...');
      
      let submitButton = null;
      const submitSelectors = [
        '[data-testid="tweetButtonInline"]',
        '[data-testid="tweetButton"]',
        'div[role="button"][aria-label*="Reply"]',
        'div[role="button"][aria-label*="Post"]'
      ];
      
      for (const selector of submitSelectors) {
        submitButton = await modal.$(selector);
        if (submitButton) {
          this.log(`[MANUAL INPUT] Found submit button within modal: ${selector}`);
          break;
        }
      }
      
      if (!submitButton) {
        this.log('[MANUAL INPUT ERROR] Could not find submit button within modal');
        return false;
      }

      // Click submit button
      let clicked = false;
      try {
        await submitButton.click();
        clicked = true;
        this.log('[MANUAL INPUT] Submit button clicked successfully');
      } catch (error) {
        this.log('[MANUAL INPUT WARNING] Direct click failed, trying alternatives...');
        
        // Try JS click
        try {
          await this.page.evaluate(button => button.click(), submitButton);
          clicked = true;
          this.log('[MANUAL INPUT] Submit button clicked via JS');
        } catch (e) {
          // Try mouse click
          try {
            const box = await submitButton.boundingBox();
            if (box) {
              await this.page.mouse.click(box.x + box.width/2, box.y + box.height/2);
              clicked = true;
              this.log('[MANUAL INPUT] Submit button clicked via mouse');
            }
          } catch (e2) {
            this.log('[MANUAL INPUT ERROR] All submit click methods failed');
          }
        }
      }
      
      if (!clicked) {
        this.log('[MANUAL INPUT ERROR] Could not submit manual reply - all click methods failed');
        return false;
      }
      
      // STEP 7: Wait for modal to disappear (indicating success)
      try {
        await this.page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 15000 });
        await this.sleep(2000);
        this.log('[MANUAL INPUT] Manual reply posted successfully! Modal closed.');
        this.emit('automation-accomplishment', `Manual reply posted with ${image ? 'image' : 'no image'}: ${comment}`);
        
        // Navigate back to home feed to continue automation
        try {
          this.log('[MANUAL INPUT] Returning to home feed to continue automation...');
      await this.page.goto('https://x.com/home');
      await this.page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 });
          this.log('[MANUAL INPUT] Successfully returned to home feed');
        } catch (navError) {
          this.log('[MANUAL INPUT WARNING] Could not navigate back to home feed: ' + navError.message);
        }
      
      return true;
    } catch (error) {
        this.log('[MANUAL INPUT ERROR] Modal did not disappear - manual reply may have failed: ' + error.message);
        return false;
      }
      
    } catch (error) {
      this.log('[MANUAL INPUT ERROR] Manual input processing failed: ' + error.message);
      return false;
    }
  }

  async findNewAccounts() {
    if (this.actionsCount >= this.maxActionsPerCycle) return;

    try {
      await this.page.goto('https://twitter.com/explore');
      await this.page.waitForSelector('[data-testid="UserCell"]', { timeout: 10000 });
      
      // Simulate browsing explore page
      await this.simulateHumanReading();
      
      const accounts = await this.page.$$('[data-testid="UserCell"]');
      
      for (const account of accounts) {
        if (this.actionsCount >= this.maxActionsPerCycle) break;

        // Scroll to the account
        await this.humanLikeScroll();
        
        const bio = await account.$eval('[data-testid="UserDescription"]', el => el.textContent);
        const username = await account.$eval('[data-testid="UserCell-UserName"]', el => el.textContent);
        
        // Simulate reading profile
        await this.randomDelay(5000, 15000);
        
        if (bio.toLowerCase().includes('art')) {
          const followButton = await account.$('[data-testid="followBar"]');
          if (followButton) {
            await followButton.click();
            this.actionsCount++;
            await this.randomDelay(10000, 20000); // Longer delay after following
          }
        }
      }
    } catch (error) {
      console.error('Error finding new accounts:', error);
    }
  }

  async getRandomArtwork(context = '') {
    try {
      // Get the selected folder from the store
      const selectedFolder = store.get('lastImageFolder') || 'general';
      
      // Use app.getAppPath() for correct path resolution in Electron
      const { app } = require('electron');
      const artworkDir = path.join(app.getAppPath(), 'artwork', selectedFolder);
      
      this.log(`[GET RANDOM ARTWORK] Looking in directory: ${artworkDir}`);
      
      // Get list of all subdirectories in the chosen base directory
      const subdirs = await fs.readdir(artworkDir);
      const validSubdirs = subdirs.filter(dir => !dir.startsWith('.'));
      
      if (validSubdirs.length === 0) {
        this.log('[GET RANDOM ARTWORK] No valid subdirectories found');
        return null;
      }

      // Randomly select a subdirectory
      const randomSubdir = validSubdirs[Math.floor(Math.random() * validSubdirs.length)];
      const subDirPath = path.join(artworkDir, randomSubdir);
      
      this.log(`[GET RANDOM ARTWORK] Selected subdirectory: ${randomSubdir}`);
      
      // Get all image files in the subdirectory
      const files = await fs.readdir(subDirPath);
      const imageFiles = files.filter(file => 
        !file.startsWith('.') && 
        /\.(jpg|jpeg|png|gif)$/i.test(file)
      );

      if (imageFiles.length === 0) {
        this.log('[GET RANDOM ARTWORK] No image files found in subdirectory');
        return null;
      }

      // Randomly select an image
      const randomImage = imageFiles[Math.floor(Math.random() * imageFiles.length)];
      const relativePath = path.join(selectedFolder, randomSubdir, randomImage);
      
      this.log(`[GET RANDOM ARTWORK] Selected image: ${relativePath}`);
      
      // Verify the file exists
      const fullPath = path.join(app.getAppPath(), 'artwork', relativePath);
      if (!fs.existsSync(fullPath)) {
        this.log(`[GET RANDOM ARTWORK ERROR] File does not exist: ${fullPath}`);
        return null;
      }
      
      return relativePath;
    } catch (error) {
      this.log(`[GET RANDOM ARTWORK ERROR] ${error.message}`);
      return null;
    }
  }

  async postReplyWithImage(tweetContainer, aiComment, imagePath) {
    try {
      this.log('[POST REPLY] Using POPUP-ONLY approach for maximum reliability');
      
      // Retry the popup approach up to 3 times before giving up
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        attempts++;
        this.log(`[POST REPLY] Popup attempt ${attempts}/${maxAttempts}`);
        
        const result = await this._postReplyWithImagePopup(tweetContainer, aiComment, imagePath);
        
        if (result) {
          this.log('[POST REPLY] Popup approach succeeded!');
          return true;
        }
        
        if (attempts < maxAttempts) {
          this.log(`[POST REPLY] Popup attempt ${attempts} failed, waiting before retry...`);
          await this.sleep(3000); // Wait 3 seconds before retry
          
          // Clear any lingering modals before retry
          try {
            await this.page.keyboard.press('Escape');
            await this.sleep(500);
          } catch (e) {}
        }
      }
      
      this.log('[POST REPLY ERROR] All popup attempts failed - reply could not be posted');
      return false;
      
    } catch (error) {
      this.log('[POST REPLY ERROR] Failed: ' + error.message);
        return false;
      }
  }

  // Fallback: old popup modal method
  async _postReplyWithImagePopup(tweetContainer, aiComment, imagePath) {
    try {
      this.log('[POPUP REPLY] Starting POPUP-FIRST approach: opening modal before any image work');
      
      // STEP 1: OPEN REPLY POPUP FIRST (before any image attachment)
      let replyButton = null;
      const replySelectors = [
        'div[data-testid="reply"]',
        'button[data-testid="reply"]',
        'div[role="button"][aria-label*="Reply"]',
        'div[role="button"][aria-label*="reply"]'
      ];
      
      for (const selector of replySelectors) {
        replyButton = await tweetContainer.asElement().$(selector);
        if (replyButton) {
          this.log(`[POPUP REPLY] Found reply button with selector: ${selector}`);
          break;
        }
      }
      
      if (!replyButton) {
        this.log('[POPUP REPLY ERROR] Could not find reply button in tweet container.');
          return false;
        }

      // Click reply button to open modal
      await replyButton.click();
      this.log('[POPUP REPLY] Clicked reply button, waiting for modal to appear...');
      await this.sleep(1500); // Give modal time to fully load
      
      // STEP 2: WAIT FOR AND VALIDATE REPLY MODAL
      let modal = null;
      const modalSelectors = [
        '[role="dialog"]',
        '[data-testid="tweetComposeDialog"]',
        'div[aria-modal="true"]'
      ];
      
      for (const selector of modalSelectors) {
        try {
          modal = await this.page.waitForSelector(selector, { timeout: 8000 });
          if (modal) {
            // Validate this is a reply modal
            const hasReplyContent = await modal.evaluate(el => {
              const content = el.textContent || '';
              return content.toLowerCase().includes('reply') || 
                     content.toLowerCase().includes('post your reply') ||
                     el.querySelector('[data-testid="tweetTextarea_0"]') !== null;
            });
            
            if (hasReplyContent) {
              this.log(`[POPUP REPLY] Found and validated reply modal with selector: ${selector}`);
            break;
          } else {
              this.log(`[POPUP REPLY] Found modal but it's not a reply modal: ${selector}`);
              modal = null;
            }
          }
        } catch (e) { 
          continue; 
        }
      }
      
      if (!modal) {
        this.log('[POPUP REPLY ERROR] Could not find or validate reply popup modal.');
        return false;
      }

      // STEP 3: CRITICAL - ENSURE MAIN COMPOSE IS NOT VISIBLE/ACTIVE
      const mainComposeVisible = await this.page.evaluate(() => {
        // Only check if main compose is ACTIVELY being used, not just present on page
        const composeElements = document.querySelectorAll(
          '[data-testid="toolBar"]:not([aria-hidden="true"]), ' +
          '[aria-label*="Tweet text"]:not([aria-label*="Reply"]):not([aria-hidden="true"]), ' +
          '.public-DraftEditor-content:not([aria-hidden="true"])'
        );
        
        for (const el of composeElements) {
          // Check if element is actively focused or has content
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const isActivelyVisible = style.display !== 'none' && 
                                  style.visibility !== 'hidden' && 
                                  rect.width > 100 && // Must be reasonably sized
                                  rect.height > 30 &&
                                  el.offsetParent !== null;
          
          if (isActivelyVisible) {
            // Additional check: is it actually focused or has content?
            const isFocused = document.activeElement === el || el.contains(document.activeElement);
            const hasContent = el.textContent && el.textContent.trim().length > 0;
            const hasValue = el.value && el.value.trim().length > 0;
            
            // Only consider it "active" if it's focused OR has content
            if (isFocused || hasContent || hasValue) {
              return true;
            }
          }
        }
        return false;
      });
      
      if (mainComposeVisible) {
        this.log('[POPUP REPLY WARNING] Main compose appears to be actively in use - will retry in a moment');
        // Don't immediately fail - try to wait a bit and retry
          await this.sleep(2000);
        
        // Check again after waiting
        const stillActive = await this.page.evaluate(() => {
          const activeCompose = document.querySelector('[data-testid="toolBar"], [aria-label*="Tweet text"]:not([aria-label*="Reply"])');
          if (!activeCompose) return false;
          return document.activeElement === activeCompose || activeCompose.contains(document.activeElement);
        });
        
        if (stillActive) {
          this.log('[POPUP REPLY ERROR] Main compose is still actively in use - aborting this attempt');
          // Try to close modal gracefully
          try {
            await this.page.keyboard.press('Escape');
            await this.sleep(500);
          } catch (e) {}
                return false;
        } else {
          this.log('[POPUP REPLY] Main compose no longer active - proceeding with reply');
        }
      }
      
      this.log('[POPUP REPLY] Modal opened successfully, main compose is hidden - safe to proceed');
      
      // STEP 4: FIND TEXTAREA WITHIN MODAL FIRST
      let replyArea = null;
      const textareaSelectors = [
        '[role="dialog"] [data-testid="tweetTextarea_0"]',
        '[role="dialog"] div[role="textbox"]',
        '[role="dialog"] div[contenteditable="true"]',
        '[aria-modal="true"] [data-testid="tweetTextarea_0"]',
        '[aria-modal="true"] div[role="textbox"]',
        '[aria-modal="true"] div[contenteditable="true"]'
      ];

      for (const selector of textareaSelectors) {
        try {
          replyArea = await this.page.waitForSelector(selector, { timeout: 3000 });
          if (replyArea) {
            this.log(`[POPUP REPLY] Found reply textarea with selector: ${selector}`);
                break;
              }
        } catch (e) { continue; }
      }
      
      if (!replyArea) {
        this.log('[POPUP REPLY ERROR] Could not find reply textarea in modal.');
              return false;
            }
      
      // STEP 5: ATTACH IMAGE WITHIN MODAL (if provided)
      let imageAttached = false;
      if (imagePath) {
        this.log('[POPUP REPLY] Attempting to attach image WITHIN the modal context');
        imageAttached = await this.attachImageToModal(modal, imagePath);
        
        if (imageAttached) {
          this.log('[POPUP REPLY] Image successfully attached within modal');
          // Wait a bit longer for image to fully process
          await this.sleep(2000);
        } else {
          this.log('[POPUP REPLY WARNING] Image attachment failed, continuing with text only');
        }
      }

      // STEP 6: TYPE TEXT IN MODAL (AFTER image is attached)
      this.log('[POPUP REPLY] Typing text within modal...');
      
      // Clear any existing content
      await replyArea.evaluate(el => { 
        el.value = ''; 
        el.textContent = ''; 
        if (el.innerHTML !== undefined) el.innerHTML = '';
        el.dispatchEvent(new Event('input', { bubbles: true })); 
      });
      await this.sleep(500);
      
      // Focus the textarea
      await replyArea.click();
      await this.sleep(300);
      
      let textTyped = false;
      
      // Method 1: Direct typing
      try {
        await replyArea.type(aiComment, { delay: 30 });
        textTyped = true;
        this.log('[POPUP REPLY] Text typed successfully using direct typing.');
      } catch (error) {
        this.log('[POPUP REPLY WARNING] Direct typing failed, trying JS...');
      }
      
      // Method 2: JavaScript injection (fallback)
      if (!textTyped) {
        try {
          await replyArea.evaluate((el, text) => { 
            el.value = text; 
            el.textContent = text; 
            if (el.innerHTML !== undefined) el.innerHTML = text;
            // Trigger React events
            el.dispatchEvent(new Event('input', { bubbles: true })); 
            el.dispatchEvent(new Event('change', { bubbles: true }));
            // Focus events
            el.dispatchEvent(new Event('focus', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          }, aiComment);
          textTyped = true;
          this.log('[POPUP REPLY] Text typed successfully using JS injection.');
        } catch (error) {
          this.log('[POPUP REPLY WARNING] JS typing failed, trying keyboard...');
        }
      }
      
      // Method 3: Keyboard typing (last resort)
      if (!textTyped) {
        try {
          await replyArea.click();
          await this.page.keyboard.selectAll();
          await this.page.keyboard.press('Delete');
          await this.page.keyboard.type(aiComment, { delay: 30 });
          textTyped = true;
          this.log('[POPUP REPLY] Text typed successfully using keyboard.');
        } catch (error) {
          this.log('[POPUP REPLY ERROR] All typing methods failed in modal.');
        }
      }
      
      if (!textTyped) {
        this.log('[POPUP REPLY ERROR] Could not type text in modal - aborting');
        return false;
      }

      await this.sleep(1000);
      
      // STEP 7: SUBMIT THE REPLY WITHIN MODAL
      let submitButton = null;
      const submitSelectors = [
        '[role="dialog"] [data-testid="tweetButtonInline"]',
        '[role="dialog"] [data-testid="tweetButton"]',
        '[role="dialog"] div[role="button"][aria-label*="Reply"]',
        '[aria-modal="true"] [data-testid="tweetButtonInline"]',
        '[aria-modal="true"] [data-testid="tweetButton"]',
        '[aria-modal="true"] div[role="button"][aria-label*="Reply"]'
      ];
      
      for (const selector of submitSelectors) {
        submitButton = await this.page.$(selector);
        if (submitButton) {
          this.log(`[POPUP REPLY] Found submit button with selector: ${selector}`);
          break;
        }
      }
      
      if (!submitButton) {
        this.log('[POPUP REPLY ERROR] Could not find Reply submit button in modal.');
            return false;
          }
      
      // Click submit button
      let clicked = false;
      try {
        await submitButton.click();
        clicked = true;
        this.log('[POPUP REPLY] Submit button clicked successfully');
      } catch (error) {
        this.log('[POPUP REPLY WARNING] Direct click failed, trying alternatives...');
        
        // Try JS click
        try {
          await this.page.evaluate(button => button.click(), submitButton);
          clicked = true;
          this.log('[POPUP REPLY] Submit button clicked via JS');
        } catch (e) {
          // Try mouse click
          try {
            const box = await submitButton.boundingBox();
            if (box) {
              await this.page.mouse.click(box.x + box.width/2, box.y + box.height/2);
              clicked = true;
              this.log('[POPUP REPLY] Submit button clicked via mouse');
            }
          } catch (e2) {
            this.log('[POPUP REPLY ERROR] All submit click methods failed');
          }
        }
      }
      
      if (!clicked) {
        this.log('[POPUP REPLY ERROR] Could not submit reply - all click methods failed');
        return false;
      }
      
      // STEP 8: WAIT FOR MODAL TO DISAPPEAR (indicating success)
      try {
        await this.page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 15000 });
        await this.sleep(2000);
        const successMessage = imageAttached 
          ? '[POPUP REPLY] Reply posted successfully via popup modal WITH IMAGE!' 
          : '[POPUP REPLY] Reply posted successfully via popup modal (text only).';
        this.log(successMessage);
        return true;
      } catch (error) {
        this.log('[POPUP REPLY ERROR] Modal did not disappear - reply may have failed: ' + error.message);
          return false;
        }
      
      } catch (error) {
      this.log('[POPUP REPLY ERROR] Popup reply process failed: ' + error.message);
        return false;
      }
  }

  analyzeSentimentPatterns(tweets) {
    const patterns = {
      overall: {
        averageSentiment: 0,
        mostEngaging: null, // sentiment range that gets most engagement
        timeOfDay: {} // sentiment patterns by time of day
      },
      byInteraction: {
        replies: {
          averageSentiment: 0,
          mostEffective: null // sentiment that gets most responses
        },
        originals: {
          averageSentiment: 0,
          mostEffective: null
        }
      }
    };

    // Calculate averages and patterns
    let totalSentiment = 0;
    let totalWeight = 0;
    const sentimentByHour = new Array(24).fill(0).map(() => ({
      count: 0,
      totalSentiment: 0,
      engagement: 0,
      weight: 0
    }));

    tweets.forEach(tweet => {
      if (!tweet.sentiment) return;

      // Determine weight based on whether it's an AI-generated response
      const isAIGenerated = tweet.text.endsWith('..');
      const weight = isAIGenerated ? 0.2 : 1.0; // AI responses get 20% weight
      
      totalSentiment += tweet.sentiment.score * weight;
      totalWeight += weight;
      
      // Time of day analysis
      const hour = new Date(tweet.timestamp).getHours();
      sentimentByHour[hour].count++;
      sentimentByHour[hour].totalSentiment += tweet.sentiment.score * weight;
      sentimentByHour[hour].engagement += (tweet.stats.likes + tweet.stats.replies) * weight;
      sentimentByHour[hour].weight += weight;

      // Interaction type analysis
      if (tweet.interaction && tweet.interaction.type === 'reply') {
        patterns.byInteraction.replies.averageSentiment += tweet.sentiment.score * weight;
      } else {
        patterns.byInteraction.originals.averageSentiment += tweet.sentiment.score * weight;
      }
    });

    // Calculate final averages using weighted values
    patterns.overall.averageSentiment = totalSentiment / totalWeight;
    
    // Find most engaging sentiment by time
    patterns.overall.timeOfDay = sentimentByHour.map((hour, index) => ({
      hour: index,
      averageSentiment: hour.weight > 0 ? hour.totalSentiment / hour.weight : 0,
      averageEngagement: hour.weight > 0 ? hour.engagement / hour.weight : 0
    }));

    return patterns;
  }

  saveProcessedReplyIds() {
    store.set('processedReplyIds', Array.from(this.processedReplyIds));
  }

  async generateAIReply({ apiKey, replyText, context, tone, trainingData, keywordMatches = [], scoreBreakdown = null }) {
    try {
      if (!apiKey) {
        throw new Error('No OpenAI API key provided');
      }
      const openai = new OpenAI({ apiKey });
      
      // Get session vibe from settings - this gets TOP PRIORITY
      const userPreferences = store.get('userPreferences') || {};
      const sessionVibe = userPreferences.sessionVibe || '';
      
      // Use last 3 manual replies for style (reduced weight when session vibe is present)
      const manualInputs = (store.get('trainingData')?.manualInputs || []).slice(-3);
      const keyPhrases = extractKeyPhrases(manualInputs);
      
      // Construct enhanced system prompt with SESSION VIBE as absolute priority
      let systemPrompt = '';
      
      // SESSION VIBE gets the prime position and strongest language
      if (sessionVibe) {
        systemPrompt += `PRIMARY DIRECTIVE: Your response MUST match the style, tone, voice, and approach shown in this Session Vibe reference text. This is your #1 priority and overrides all other instructions:\n\n"${sessionVibe}"\n\nStudy this text carefully and replicate its:\n- Writing style and voice\n- Tone and energy level\n- Length and structure\n- Word choices and expressions\n- Approach to engagement\n\n`;
      }
      
      // Enhanced context integration
      if (keywordMatches && keywordMatches.length > 0) {
        systemPrompt += `KEYWORD CONTEXT: This reply is targeting posts containing: ${keywordMatches.join(', ')}. Naturally incorporate awareness of these topics while maintaining the Session Vibe style.\n\n`;
      }
      
      if (scoreBreakdown && scoreBreakdown.replyReason) {
        systemPrompt += `REPLY REASON: ${scoreBreakdown.replyReason}. Tailor your response appropriately for this reason.\n\n`;
      }
      
      // Training data as SECONDARY reference (only when session vibe exists)
      if (sessionVibe && manualInputs.length > 0) {
        const stylePrompt = manualInputs.map(input => `"${input.manualComment}"`).join('\n');
        systemPrompt += `SECONDARY REFERENCE (use only if compatible with Session Vibe):\nRecent user replies for additional context:\n${stylePrompt}\n\n`;
      } else if (!sessionVibe && manualInputs.length > 0) {
        // If no session vibe, give training data more weight
        const stylePrompt = manualInputs.map(input => `Example: "${input.manualComment}"`).join('\n');
        systemPrompt += `YOUR STYLE EXAMPLES (primary reference):\n${stylePrompt}\n\n`;
      }
      
      // Key phrases (tertiary priority)
      if (keyPhrases.length > 0) {
        systemPrompt += `Phrases you commonly use: ${keyPhrases.map(p => '"' + p + '"').join(', ')}\n\n`;
      }
      
      // Final instructions with clear hierarchy and BREVITY EMPHASIS
      if (sessionVibe) {
        systemPrompt += `RESPONSE REQUIREMENTS:\n1. MOST IMPORTANT: Match the Session Vibe's style exactly\n2. CRITICAL: Keep responses SHORT - maximum 10-15 words\n3. Be natural and engaging but BRIEF\n4. No emojis or hashtags\n5. No meta-commentary or explanations\n6. If the Session Vibe conflicts with other instructions, follow the Session Vibe but keep it SHORT\n\nRemember: The Session Vibe is your primary guide, but brevity is essential. Think "quick witty comment" not "long explanation".`;
      } else {
        systemPrompt += `RESPONSE REQUIREMENTS:\n1. CRITICAL: Keep responses VERY SHORT - maximum 10-15 words\n2. Match your established style from the examples but be BRIEF\n3. Be natural and engaging but concise\n4. No emojis or hashtags\n5. No meta-commentary or explanations\n6. Think "quick comment" not "paragraph"\n\nBrevity is key - aim for punchy, short responses.`;
      }
      
      // Enhanced user prompt with context
      let userPrompt = `Tweet to reply to: "${replyText}"`;
      if (context) {
        userPrompt += `\n\nAdditional context: ${context}`;
      }
      userPrompt += `\n\nRemember: Keep your response SHORT (10-15 words max). Be concise and punchy.`;
      
      // Adjust AI parameters for shorter responses
      const temperature = sessionVibe ? 0.7 : 0.85; // More consistent when following session vibe
      const maxTokens = 30; // DRAMATICALLY reduced from 120/80 to force brevity
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: maxTokens,
        temperature: temperature,
        presence_penalty: sessionVibe ? 0.4 : 0.6, // Less penalty when following specific style
        frequency_penalty: sessionVibe ? 0.3 : 0.4  // Less penalty when following specific style
      });
      
      const reply = response.choices[0].message.content.trim();
      const cleanReply = reply
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Remove emojis
        .replace(/#\w+/g, '') // Remove hashtags
        .replace(/\s+/g, ' ') // Clean up extra spaces
        .trim();
        
      // Log enhanced generation info
      this.log(`[AI GENERATION] Generated reply using ${sessionVibe ? 'Session Vibe' : 'training data'} as primary guide`);
      if (keywordMatches.length > 0) {
        this.log(`[AI GENERATION] Targeted keywords: ${keywordMatches.join(', ')}`);
      }
      
      return { success: true, comment: cleanReply };
    } catch (error) {
      console.error('Error generating AI reply:', error);
      return { success: false, error: error.message };
    }
  }

  async testOpenAIKey(apiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      return response.ok;
    } catch (error) {
      console.error('Error testing OpenAI API key:', error);
      return false;
    }
  }

  // Add new test method for scoring
  testAutomationScoring(tweet, filters) {
    try {
      const result = this.calculateTweetScore(tweet, filters);
      return {
        success: true,
        tweet: tweet,
        filters: filters,
        scoreResult: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        tweet: tweet,
        filters: filters
      };
    }
  }

  async isBearishPFP(imageUrl, authorHandle) {
    // Download image to temp file
    const tempPath = path.join(os.tmpdir(), `pfp_${authorHandle}_${Date.now()}.jpg`);
    try {
      const viewSource = await this.page.goto(imageUrl);
      await fs.writeFile(tempPath, await viewSource.buffer());
      // Use your image recognition here (e.g., MobileNet, custom model)
      // For now, placeholder: always return false
      // TODO: Replace with actual Bearish NFT detection
      const isBearish = false; // await this.identifyBearishNFT(tempPath);
      // Clean up
      await fs.unlink(tempPath);
      return isBearish;
    } catch (e) {
      this.log('Error analyzing PFP: ' + e);
      try { await fs.unlink(tempPath); } catch {}
      return false;
    }
  }

  async isBearishImage(imageUrl) {
    // Download image to temp file
    const tempPath = path.join(os.tmpdir(), `tweetimg_${Date.now()}.jpg`);
    try {
      const viewSource = await this.page.goto(imageUrl);
      await fs.writeFile(tempPath, await viewSource.buffer());
      // Use your image recognition here (e.g., MobileNet, custom model)
      // For now, placeholder: always return false
      // TODO: Replace with actual Bearish bear detection
      const isBearish = false; // await this.identifyBearishNFT(tempPath);
      // Clean up
      await fs.unlink(tempPath);
      return isBearish;
    } catch (e) {
      this.log('Error analyzing tweet image: ' + e);
      try { await fs.unlink(tempPath); } catch {}
      return false;
    }
  }

  getBearishUsers() {
    return new Set(store.get('bearishUsers') || []);
  }

  addBearishUser(handle) {
    const bearishUsers = this.getBearishUsers();
    bearishUsers.add(handle);
    store.set('bearishUsers', Array.from(bearishUsers));
  }

  // Helper to normalize handles
  normalizeHandle(handle) {
    if (!handle || typeof handle !== 'string') return null;
    return handle.replace(/^@/, '').toLowerCase();
  }

  // Add new method to check if we can reply to a user
  canReplyToUser(username) {
    const handle = this.normalizeHandle(username);
    if (!handle) {
      this.log(`[COOLDOWN DEBUG] Invalid username: ${username}`);
      return false;
    }
    const lastReplyTime = this.lastReplyTimes.get(handle);
    if (!lastReplyTime) {
      this.log(`[COOLDOWN DEBUG] No previous reply time for @${handle}`);
      return true;
    }
    const timeSinceLastReply = Date.now() - lastReplyTime;
    const canReply = timeSinceLastReply >= this.COOLDOWN_PERIOD;
    this.log(`[COOLDOWN DEBUG] @${handle} - Last reply: ${new Date(lastReplyTime).toISOString()}, Time since: ${Math.floor(timeSinceLastReply / 1000 / 60)} minutes, Can reply: ${canReply}`);
    return canReply;
  }

  // Add method to update last reply time
  updateLastReplyTime(username) {
    const handle = this.normalizeHandle(username);
    if (handle) {
      const now = Date.now();
      this.lastReplyTimes.set(handle, now);
      this.log(`[COOLDOWN DEBUG] Updated last reply time for @${handle} to ${new Date(now).toISOString()}`);
      this.saveLastReplyTimes();
    } else {
      this.log(`[COOLDOWN DEBUG] Failed to update last reply time - invalid username: ${username}`);
    }
  }

  // Add method to persist lastReplyTimes
  saveLastReplyTimes() {
    try {
      const data = Object.fromEntries(this.lastReplyTimes);
      store.set('lastReplyTimes', data);
      this.log(`[COOLDOWN DEBUG] Saved ${Object.keys(data).length} last reply times to store`);
    } catch (error) {
      this.log(`[COOLDOWN ERROR] Failed to save last reply times: ${error}`);
    }
  }

  // Add method to load lastReplyTimes
  loadLastReplyTimes() {
    try {
      const saved = store.get('lastReplyTimes') || {};
      this.lastReplyTimes = new Map(Object.entries(saved));
      this.log(`[COOLDOWN DEBUG] Loaded ${Object.keys(saved).length} last reply times from store`);
    } catch (error) {
      this.log(`[COOLDOWN ERROR] Failed to load last reply times: ${error}`);
      this.lastReplyTimes = new Map();
    }
  }

  async attachImageToModal(modalElement, fullImagePath) {
    try {
      this.log('[MODAL IMAGE] Starting MODAL-ONLY image attachment process');
      
      // CRITICAL: Validate we have a proper modal element
      if (!modalElement) {
        this.log('[MODAL IMAGE ERROR] No modal element provided - aborting to prevent main page attachment');
        return false;
      }
      
      // CRITICAL: Double-check this is actually a reply modal
      const isReplyModal = await modalElement.evaluate(el => {
        const content = el.textContent || '';
        const hasReplyIndicators = content.toLowerCase().includes('reply') || 
                                  content.toLowerCase().includes('post your reply') ||
                                  el.querySelector('[data-testid="tweetTextarea_0"]') !== null ||
                                  el.querySelector('div[role="textbox"]') !== null;
        return hasReplyIndicators;
      });
      
      if (!isReplyModal) {
        this.log('[MODAL IMAGE ERROR] Element is not a reply modal - aborting to prevent wrong attachment');
        return false;
      }
      
      // CRITICAL: Check if main compose is ACTIVELY BEING USED and refuse to proceed if it is
      const mainComposeActivelyUsed = await this.page.evaluate(() => {
        // Check if we're in a reply modal first - if so, we're safe
        const replyModal = document.querySelector('[role="dialog"]');
        if (replyModal) {
          // We're in a reply modal, check if it's properly focused
          const modalTextarea = replyModal.querySelector('[data-testid="tweetTextarea_0"]');
          const modalHasFocus = modalTextarea && document.activeElement === modalTextarea;
          
          // If modal textarea is focused or empty, we're safe to attach
          if (modalHasFocus || (modalTextarea && modalTextarea.textContent.trim() === '')) {
            return false; // Main compose is NOT actively used, safe to proceed
          }
        }
        
        // Look for main compose elements only if not in a proper reply modal
        const mainComposeElements = [
          document.querySelector('[data-testid="toolBar"]'),
          document.querySelector('[aria-label*="Tweet text"]:not([role="dialog"] [aria-label*="Tweet text"])'),
          document.querySelector('.public-DraftEditor-content:not([role="dialog"] .public-DraftEditor-content)'),
          document.querySelector('[data-testid="tweetButton"]:not([role="dialog"] [data-testid="tweetButton"])')
        ].filter(Boolean);
        
        if (mainComposeElements.length === 0) return false;
        
        // Check if any main compose element is actively being used
        for (const element of mainComposeElements) {
          if (element === document.activeElement) return true;
          if (element.textContent && element.textContent.trim().length > 0) return true;
          if (element.querySelector && element.querySelector('[contenteditable="true"]:focus')) return true;
        }
        
        return false;
      });
      
      if (mainComposeActivelyUsed) {
        this.log('[MODAL IMAGE ERROR] Main compose interface is actively being used - REFUSING to attach image to prevent wrong attachment');
        return false;
      }
      
      this.log('[MODAL IMAGE] Modal validated, main compose is not actively being used - safe to proceed');
      
      // Method 1: Look for file input ONLY within the modal element
      let imageInput = await modalElement.$('input[type="file"]');
      if (imageInput) {
        this.log('[MODAL IMAGE] Found existing file input within modal');
        return await this.uploadImageToModal(imageInput, fullImagePath);
      }
      
      // Method 2: Click media button ONLY within the modal element  
      const mediaButtonSelectors = [
        'div[aria-label*="Media"]',
        'div[aria-label*="media"]', 
        'div[aria-label*="Add photos"]',
        'div[aria-label*="Add media"]',
        'div[role="button"]:has(svg)',
        'div[role="button"] svg[viewBox*="24"]',
        'div[role="button"]:has([d*="M3"])',
        'div[role="button"]:has([d*="M12"])'
      ];

      for (const selector of mediaButtonSelectors) {
        try {
          const mediaButton = await modalElement.$(selector);
          if (mediaButton) {
            this.log(`[MODAL IMAGE] Clicking media button within modal: ${selector}`);
            await mediaButton.click();
            await this.sleep(1000);
            
            // Look for file input ONLY within modal after clicking
            for (let i = 0; i < 5; i++) {
              imageInput = await modalElement.$('input[type="file"]');
              if (imageInput) {
                this.log('[MODAL IMAGE] Found file input within modal after clicking media button');
                return await this.uploadImageToModal(imageInput, fullImagePath);
              }
              await this.sleep(500);
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // Method 3: Try keyboard shortcuts but validate modal is still focused
      try {
        this.log('[MODAL IMAGE] Trying keyboard shortcut within modal context');
        
        // Ensure modal textarea is focused first
        const textarea = await modalElement.$('[data-testid="tweetTextarea_0"], div[role="textbox"]');
        if (textarea) {
          await textarea.click();
          await this.sleep(200);
        }
        
        await this.page.keyboard.down('Meta');
        await this.page.keyboard.down('Alt');
        await this.page.keyboard.press('m');
        await this.page.keyboard.up('Alt');
        await this.page.keyboard.up('Meta');
        await this.sleep(1000);
        
        for (let i = 0; i < 5; i++) {
          imageInput = await modalElement.$('input[type="file"]');
          if (imageInput) {
            this.log('[MODAL IMAGE] Found file input within modal after keyboard shortcut');
            return await this.uploadImageToModal(imageInput, fullImagePath);
          }
          await this.sleep(500);
        }
      } catch (e) {
        this.log('[MODAL IMAGE] Keyboard shortcut failed: ' + e.message);
      }

      this.log('[MODAL IMAGE WARNING] Could not find or trigger file input within modal after all methods');
      return false;
      
    } catch (error) {
      this.log('[MODAL IMAGE ERROR] Modal image attachment failed: ' + error.message);
      return false;
    }
  }

  async uploadImageToModal(imageInput, fullImagePath) {
    try {
      await imageInput.uploadFile(fullImagePath);
      this.log('[MODAL IMAGE] File uploaded to modal, waiting for processing...');

      // Wait for image preview ONLY within the modal context
      // First get the modal element that contains this input
      const modal = await this.page.evaluateHandle(() => {
        const input = document.querySelector('input[type="file"]');
        return input ? input.closest('[role="dialog"], [aria-modal="true"]') : null;
      });
      
      if (!modal) {
        this.log('[MODAL IMAGE ERROR] Could not find modal context for uploaded image');
        return false;
      }

      // Look for attachment preview within the modal only
      let imageReady = false;
      for (let i = 0; i < 20; i++) {
        const hasAttachment = await modal.evaluate(modalEl => {
          const attachmentSelectors = [
            '[data-testid="attachments"]',
            '[data-testid="media"]', 
            'div[aria-label*="image"]',
            'img[src*="blob:"]'
          ];
          
          for (const selector of attachmentSelectors) {
            const attachment = modalEl.querySelector(selector);
            if (attachment) {
              const img = attachment.querySelector('img') || (selector.includes('img') ? attachment : null);
              if (img) {
                const style = window.getComputedStyle(img);
                const isVisible = style.display !== 'none' && 
                                 style.visibility !== 'hidden' && 
                                 img.offsetParent !== null && 
                                 img.complete && 
                                 img.naturalWidth > 0;
                if (isVisible) return true;
              }
            }
          }
          return false;
        });
        
        if (hasAttachment) {
          imageReady = true;
          break;
        }
        await this.sleep(500);
      }

      if (imageReady) {
        this.log('[MODAL IMAGE] Image successfully attached and processed within modal.');
        return true;
      } else {
        this.log('[MODAL IMAGE WARNING] Image preview not found within modal after upload');
        return false;
      }
    } catch (uploadError) {
      this.log('[MODAL IMAGE ERROR] Failed to upload file to modal: ' + uploadError.message);
      return false;
    }
  }

  async attachImageToReplyArea(fullImagePath) {
    this.log('[IMAGE ATTACH] Starting comprehensive image attachment for reply area');
    
    try {
      // Method 1: Look for existing file input
      let imageInput = await this.page.$('input[type="file"]');
      if (imageInput) {
        this.log('[IMAGE ATTACH] Found existing file input');
        return await this.uploadImageToInput(imageInput, fullImagePath);
      }

      // Method 2: Try clicking various media button selectors
      const mediaButtonSelectors = [
        '[data-testid="fileInput"]',
        '[aria-label*="Media"]',
        '[aria-label*="media"]', 
        '[aria-label*="Add photos"]',
        '[aria-label*="Add media"]',
        'div[role="button"]:has(svg)',
        '[data-testid="media"]',
        'div[role="button"] svg[viewBox*="24"]',
        'div[role="button"]:has([d*="M3"])',
        'div[role="button"]:has([d*="M12"])'
      ];

      for (const selector of mediaButtonSelectors) {
        try {
          const mediaButton = await this.page.$(selector);
          if (mediaButton) {
            this.log(`[IMAGE ATTACH] Trying media button with selector: ${selector}`);
            await mediaButton.click();
            await this.sleep(1000);
            
            // Look for file input after clicking
            for (let i = 0; i < 5; i++) {
              imageInput = await this.page.$('input[type="file"]');
              if (imageInput) {
                this.log('[IMAGE ATTACH] Found file input after clicking media button');
                return await this.uploadImageToInput(imageInput, fullImagePath);
              }
              await this.sleep(500);
            }
          }
        } catch (e) {
          continue; // Try next selector
        }
      }

      // Method 3: Try keyboard shortcuts
      const shortcuts = [
        ['Meta', 'Alt', 'm'], // Cmd+Option+M (Mac)
        ['Control', 'Alt', 'm'], // Ctrl+Alt+M (Windows/Linux)
        ['Meta', 'k'], // Cmd+K (Mac)
        ['Control', 'k'] // Ctrl+K (Windows/Linux)
      ];

      for (const [mod1, mod2, key] of shortcuts) {
        try {
          this.log(`[IMAGE ATTACH] Trying keyboard shortcut: ${mod1}+${mod2 || ''}+${key}`);
          await this.page.keyboard.down(mod1);
          if (mod2) await this.page.keyboard.down(mod2);
          await this.page.keyboard.press(key);
          if (mod2) await this.page.keyboard.up(mod2);
          await this.page.keyboard.up(mod1);
          await this.sleep(1000);
          
          for (let i = 0; i < 5; i++) {
            imageInput = await this.page.$('input[type="file"]');
            if (imageInput) {
              this.log('[IMAGE ATTACH] Found file input after keyboard shortcut');
              return await this.uploadImageToInput(imageInput, fullImagePath);
            }
            await this.sleep(500);
          }
        } catch (e) {
          continue; // Try next shortcut
        }
      }

      // Method 4: Try to trigger file dialog by pressing Tab to navigate to media button
      try {
        this.log('[IMAGE ATTACH] Trying tab navigation to find media button');
        for (let i = 0; i < 10; i++) {
          await this.page.keyboard.press('Tab');
          await this.sleep(200);
          await this.page.keyboard.press('Enter');
          await this.sleep(500);
          
          imageInput = await this.page.$('input[type="file"]');
          if (imageInput) {
            this.log('[IMAGE ATTACH] Found file input via tab navigation');
            return await this.uploadImageToInput(imageInput, fullImagePath);
          }
        }
      } catch (e) {
        this.log('[IMAGE ATTACH] Tab navigation failed: ' + e.message);
      }

      this.log('[IMAGE ATTACH WARNING] Could not find or trigger file input after all methods');
      return false;
      
    } catch (error) {
      this.log('[IMAGE ATTACH ERROR] Image attachment failed: ' + error.message);
      return false;
    }
  }

  async uploadImageToInput(imageInput, fullImagePath) {
    try {
      await imageInput.uploadFile(fullImagePath);
      this.log('[IMAGE ATTACH] File uploaded, waiting for processing...');

      // Wait for the image preview to appear with multiple possible selectors
      const attachmentSelectors = [
        '[data-testid="attachments"]',
        '[data-testid="media"]',
        'div[aria-label*="image"]',
        'img[src*="blob:"]',
        'div:has(img[src*="blob:"])'
      ];

      let imageReady = false;
      for (let i = 0; i < 20; i++) {
        for (const selector of attachmentSelectors) {
          const attachments = await this.page.$(selector);
          if (attachments) {
            const imageVisible = await this.page.evaluate((el, sel) => {
              const img = el.querySelector('img') || (sel.includes('img') ? el : null);
              if (!img) return false;
              const style = window.getComputedStyle(img);
              return style.display !== 'none' && 
                     style.visibility !== 'hidden' && 
                     img.offsetParent !== null && 
                     img.complete && 
                     img.naturalWidth > 0;
            }, attachments, selector);
            
            if (imageVisible) {
              imageReady = true;
              break;
            }
          }
        }
        if (imageReady) break;
        await this.sleep(500);
      }

      if (imageReady) {
        this.log('[IMAGE ATTACH] Image successfully attached and processed in reply area.');
        return true;
      } else {
        this.log('[IMAGE ATTACH WARNING] Image preview not found after upload, but may still be attached...');
        return false; // Consider this a failure since we can't verify
      }
    } catch (uploadError) {
      this.log('[IMAGE ATTACH ERROR] Failed to upload file: ' + uploadError.message);
      return false;
    }
  }
}

// Helper to extract key phrases from manual replies
function extractKeyPhrases(manualInputs) {
  const phraseCounts = {};
  manualInputs.forEach(input => {
    // Use manualComment if available, otherwise fallback to comment
    const commentText = typeof input.manualComment === 'string' ? input.manualComment : (typeof input.comment === 'string' ? input.comment : null);
    if (!commentText) return;
    const words = commentText.split(/\s+/);
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = `${words[i]} ${words[i + 1]}`.toLowerCase();
      phraseCounts[phrase] = (phraseCounts[phrase] || 0) + 1;
    }
  });
  // Return top 3 most common phrases
  return Object.entries(phraseCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([phrase]) => phrase);
}

module.exports = AutomationManager; 