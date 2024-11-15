require('dotenv').config();
const express = require('express');
const { Client } = require('twitter.js');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
app.use(express.json());

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Twitter client with environment variables
const credentials = {
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
};

// Debug log raw credentials (with length only)
console.log('Raw Twitter credentials:', {
  appKey: credentials.appKey ? 'present' : 'missing',
  appSecret: credentials.appSecret ? 'present' : 'missing',
  accessToken: credentials.accessToken ? 'present' : 'missing',
  accessSecret: credentials.accessSecret ? 'present' : 'missing',
  lengths: {
    appKey: credentials.appKey?.length || 0,
    appSecret: credentials.appSecret?.length || 0,
    accessToken: credentials.accessToken?.length || 0,
    accessSecret: credentials.accessSecret?.length || 0
  }
});

const twitterClient = new Client(credentials);

// Initialize the client before use
(async () => {
  try {
    // Debug log the client configuration
    console.log('Twitter client configuration:', {
      hasClient: !!twitterClient,
      hasOptions: !!twitterClient?.options,
      credentials: {
        hasAppKey: !!credentials.appKey,
        hasAppSecret: !!credentials.appSecret,
        hasAccessToken: !!credentials.accessToken,
        hasAccessSecret: !!credentials.accessSecret
      }
    });

    // Login with the same credentials object
    await twitterClient.login(credentials);
    
    console.log('Twitter client successfully logged in');
  } catch (error) {
    console.error('Failed to initialize Twitter client:', error);
    
    // Add additional debug logging
    console.error('Client state:', {
      hasClient: !!twitterClient,
      hasOptions: !!twitterClient?.options,
      credentialsPresent: !!credentials,
      credentialKeys: Object.keys(credentials)
    });
  }
})();

// Debug logging
console.log('Twitter credentials loaded:', {
  hasAppKey: !!process.env.TWITTER_API_KEY,
  hasAppSecret: !!process.env.TWITTER_API_SECRET,
  hasAccessToken: !!process.env.TWITTER_ACCESS_TOKEN,
  hasAccessSecret: !!process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// Function to post a tweet with retry logic
const postTweet = async (tweetContent, hashtags) => {
  const formatTweet = (content, tags) => {
    const hashtagString = tags.map(tag => `#${tag.replace(/^#/, '')}`).join(' ');
    return `${content}\n\n${hashtagString}`.trim();
  };

  const validateTweetContent = (content, tags) => {
    if (tags.length > 1) {
      throw new Error('Tweet can only have one hashtag');
    }
    const hashtagString = tags.map(tag => `#${tag.replace(/^#/, '')}`).join(' ');
    const fullTweetLength = content.length + (tags.length > 0 ? 2 : 0) + hashtagString.length;
    if (fullTweetLength > 280) {
      throw new Error(`Tweet exceeds character limit (${fullTweetLength}/280)`);
    }
  };

  const postWithRetry = async (tweet, attempt = 1) => {
    try {
      console.log(`Attempt ${attempt} to post tweet: "${tweet}"`);
      const response = await twitterClient.tweets.create({ text: tweet });
      console.log('Tweet posted successfully:', response);
      return response.id;
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      if (attempt < MAX_RETRIES) {
        console.log(`Waiting ${RETRY_DELAY * attempt}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
        return postWithRetry(tweet, attempt + 1);
      }
      throw new Error(`Failed to post tweet after ${MAX_RETRIES} attempts: ${error.message}`);
      throw error;
    }
  };

  try {
    validateTweetContent(tweetContent, hashtags);
    const fullTweet = formatTweet(tweetContent, hashtags);
    return await postWithRetry(fullTweet);
  } catch (error) {
    console.error('Error in postTweet:', error.message);
    throw error;
  }
};

// Webhook endpoint to receive transaction data from Helius
app.post('/webhook', async (req, res) => {
  try {
    const data = req.body;
    console.log("Incoming webhook data:", JSON.stringify(data, null, 2));

    if (data[0]?.tokenTransfers && data[0].tokenTransfers.length > 0) {
      const lastTransfer = data[0].tokenTransfers[data[0].tokenTransfers.length - 1];
      const contractAddress = lastTransfer.mint;
      console.log(`Token Transfer Detected for token: ${contractAddress}`);

      await generateShillMessage(contractAddress);
    } else {
      console.log("No token transfers found in this transaction.");
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Error handling webhook:", error);
    res.sendStatus(500);
  }
});

async function getTokenTicker(contractAddress) {
  try {
    const url = `https://api.dexscreener.io/latest/dex/tokens/${contractAddress}`;
    const response = await axios.get(url);

    if (response.data && response.data.pairs && response.data.pairs.length > 0) {
      const ticker = response.data.pairs[0].baseToken.symbol;
      console.log(`Fetched Ticker: ${ticker}`);
      return ticker;
    } else {
      console.log(`No data found for contract: ${contractAddress}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching token ticker for contract ${contractAddress}:`, error.message);
    return null;
  }
}

async function generateShillMessage(contractAddress) {
  try {
    const ticker = await getTokenTicker(contractAddress);

    const prompts = [
      `Write a very short, enthusiastic promotional message (maximum 200 characters) for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `The token symbol is ${ticker}.` : ""} Include one hashtag.`,

      `Create a brief, provocative message (under 200 characters) for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `Token symbol: ${ticker}.` : ""} Include one hashtag.`,

      `Write a concise, supportive message (max 200 characters) for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `Known as ${ticker}.` : ""} Include one hashtag.`
    ];

    const prompt = prompts[Math.floor(Math.random() * prompts.length)];

    let retries = 3;
    let delay = 2000;

    while (retries > 0) {
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { 
              role: 'system', 
              content: 'You must generate messages that are under 200 characters. Be very concise.' 
            },
            { 
              role: 'user', 
              content: prompt 
            }
          ],
          max_tokens: 100,
        });

        let shillMessage = response.choices[0].message.content.trim();

        // Truncate message if it's still too long
        if (shillMessage.length > 200) {
          const lastPeriodIndex = shillMessage.lastIndexOf('.', 200);
          const lastSpaceIndex = shillMessage.lastIndexOf(' ', 200);
          const truncateIndex = Math.max(lastPeriodIndex, lastSpaceIndex);
          shillMessage = truncateIndex > 0 ? shillMessage.substring(0, truncateIndex) : shillMessage.substring(0, 200);
        }

        console.log("Generated Shill Message:", shillMessage);

        await postTweet(shillMessage, [ticker || "Crypto"]);
        break;
      } catch (error) {
        if (error.response && error.response.status === 429 && retries > 0) {
          console.log(`Rate limit exceeded. Retrying in ${delay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          retries--;
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    console.error("Error generating shill message:", error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`KOLAgent server running on port ${PORT}`));
