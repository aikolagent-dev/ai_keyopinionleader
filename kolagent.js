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

// Initialize Twitter client
const twitterClient = new Client();

// Add login initialization
(async function initializeTwitter() {
  try {
    // Create credentials exactly as they expect
    const credentials = {
      consumerKey: process.env.TWITTER_API_KEY + '',  // Force string conversion
      consumerSecret: process.env.TWITTER_API_SECRET + '',
      accessToken: process.env.TWITTER_ACCESS_TOKEN + '',
      accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET + '',
      bearerToken: process.env.TWITTER_BEARER_TOKEN + ''  // Include bearer token
    };

    // Log types for debugging
    console.log('Credential types:', {
      consumerKey: typeof credentials.consumerKey,
      consumerSecret: typeof credentials.consumerSecret,
      accessToken: typeof credentials.accessToken,
      accessTokenSecret: typeof credentials.accessTokenSecret,
      bearerToken: typeof credentials.bearerToken
    });

    // Try to authenticate
    await twitterClient.login({
      ...credentials,
      type: 'user'  // Specify auth type
    });
    
    console.log('Twitter client authenticated successfully');
  } catch (error) {
    console.error('Twitter authentication error:', error);
    // Log the actual credentials object (safely)
    console.error('Credentials debug:', {
      hasConsumerKey: !!credentials.consumerKey,
      hasConsumerSecret: !!credentials.consumerSecret,
      hasAccessToken: !!credentials.accessToken,
      hasAccessTokenSecret: !!credentials.accessTokenSecret,
      hasBearerToken: !!credentials.bearerToken
    });
    process.exit(1);
  }
})();

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
      const response = await twitterClient.tweets.create({ text: tweet });
      return response.id;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
        return postWithRetry(tweet, attempt + 1);
      }
      throw new Error(`Failed to post tweet after ${MAX_RETRIES} attempts: ${error.message}`);
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
      `Draft a mysterious message for a coin with contract address ${contractAddress}. 
       ${ticker ? `The token is ${ticker}.` : ""} Use a cryptic tone to intrigue readers. Keep it under 280 characters, use only one hashtag, include not emojis.`,

      `Write a rude message for a coin with contract address ${contractAddress}. 
       ${ticker ? `Token symbol: ${ticker}.` : ""} Use a blunt tone to provoke readers into action. Keep it under 280 characters, include a hashtag of ${ticker}.`,

      `Write derogatory message in for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `The token is ${ticker}.` : ""} Use phrases like 'just aped' or 'top blasted'. Keep it under 280 characters, include one hashtag of the ticker , and use one emoji matching ${ticker}.`,

      `Draft an intellectual and smart message for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `Known as ${ticker}.` : ""} Mention it's a paid shill but encourage DYOR. Keep it under 280 characters, use one hashtag, and add fitting emojis for ${ticker}.`,

      `Write a message promoting a memecoin with contract address ${contractAddress}. It shuld start with "The ticker is ${ticker}".
       ${ticker ? `The ticker is ${ticker}.` : ""} Use a neutral tone to highlight the token's basics. Keep it under 280 characters, use one hashtag, and include emojis that represent ${ticker}.`
    ];

    const prompt = prompts[Math.floor(Math.random() * prompts.length)];

    let retries = 2;
    let delay = 5000;

    while (retries > 0) {
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 100,
        });

        const shillMessage = response.choices[0].message.content.trim();
        console.log("Generated Shill Message:", shillMessage);

        await postTweet(shillMessage, [ticker || "Crypto"]);
        break;
      } catch (error) {
        if (error.response && error.response.status === 429 && retries > 0) {
          console.log(`Rate limit exceeded. Retrying in ${delay / 2000} seconds...`);
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