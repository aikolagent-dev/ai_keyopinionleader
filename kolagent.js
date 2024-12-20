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
      const tokenAmount = parseFloat(lastTransfer.tokenAmount);
      console.log(`Token Transfer Detected - Amount: ${tokenAmount}, Token: ${contractAddress}`);

      // Pass the token amount to generateShillMessage
      await generateShillMessage(contractAddress, tokenAmount);
    } else {
      console.log("No token transfers found in this transaction.");
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Error handling webhook:", error);
    res.sendStatus(500);
  }
});

async function getTokenTicker(contractAddress, tokenAmount) {
  try {
    // Early return if contract matches the excluded address
    if (contractAddress === 'H77hQhPE24kE9zQqCmJRoBCzLzMtdMTr7zUwaKyDuhat') {
      console.log('Excluded contract address detected. Skipping tweet generation.');
      return null;
    }

    const url = `https://api.dexscreener.io/latest/dex/tokens/${contractAddress}`;
    const response = await axios.get(url);

    if (response.data && response.data.pairs && response.data.pairs.length > 0) {
      const pair = response.data.pairs[0];
      const ticker = pair.baseToken.symbol;
      const description = pair.baseToken.name || ticker; // Fallback to ticker if no name
      const priceUsd = parseFloat(pair.priceUsd);
      const totalValue = priceUsd * tokenAmount;

      if (totalValue < 25) {
        console.log(`Total transaction value ($${totalValue.toFixed(2)}) is below $25 threshold. Skipping.`);
        return null;
      }

      console.log(`Fetched Token: ${ticker} (${description}) with price: $${priceUsd}`);
      console.log(`Total transaction value: $${totalValue.toFixed(2)}`);
      return { ticker, description }; // Return both ticker and description
    } else {
      console.log(`No data found for contract: ${contractAddress}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching token data for contract ${contractAddress}:`, error.message);
    return null;
  }
}

async function generateShillMessage(contractAddress, tokenAmount) {
  try {
    const tokenData = await getTokenTicker(contractAddress, tokenAmount);
    
    if (!tokenData) {
      console.log('No valid token data found or transaction value too low. Skipping tweet generation.');
      return;
    }

    const { ticker, description } = tokenData;

    const prompts = [
      `You are a memecoin enthusiast. Write a derogatory message about those who still haven't bought ${ticker} (${description}). Tell them it's now or never. It should end with CA: ${contractAddress}. Use only one hashtag (#${ticker}) and only one emoji related to ${ticker}. Must be under 270 characters. Never use quotation marks.`,
      
      `You are a memecoin enthusiast. Write a cryptic message about ${ticker} (${description}). It should end with CA: ${contractAddress}. Use only one hashtag (#${ticker}) and only one emoji related to ${ticker}. Must be under 270 characters. Never use quotation marks.`,
      
      `You are a memecoin enthusiast. Write a message which only contains The ticker is ${ticker}. CA=${contractAddress}. Use only one hashtag (#${ticker}) and no emojis. Must be under 270 characters. Never use quotation marks.`,
      
      `You are a memecoin enthusiast. Write a playful and lighthearted message about ${ticker} (${description}). Make it casual and fun, including a joke or a meme-worthy phrase. End with CA: ${contractAddress}. Use only one hashtag (#${ticker}) and one emoji related to ${ticker}. Must be under 270 characters. Never use quotation marks.`,
      
      `You are a memecoin enthusiast. Write a FOMO-inducing message about ${ticker} (${description}). Emphasize urgency, scarcity, or a once-in-a-lifetime opportunity. End with CA: ${contractAddress}. Use only one hashtag (#${ticker}) and one emoji related to ${ticker}. Must be under 270 characters. Never use quotation marks.`,
      
      `You are a memecoin enthusiast. Write a message about ${ticker} (${description}) that makes the audience feel like joining an exclusive club or being part of a special group. Use phrases like only for the visionaries or for the few who know. End with CA: ${contractAddress}. Use only one hashtag (#${ticker}) and one emoji related to ${ticker}. Must be under 270 characters. Never use quotation marks.`,
      
      `You are a memecoin enthusiast. Write a message about ${ticker} (${description}) using a creative comparison or metaphor, such as comparing it to a rocket, treasure chest, or golden ticket. Make it engaging and memorable. End with CA: ${contractAddress}. Use only one hashtag (#${ticker}) and one emoji related to ${ticker}. Must be under 270 characters. Never use quotation marks.`,
      
      `You are a memecoin enthusiast. Write a bold and confident message about ${ticker} (${description}), making an ambitious prediction about its future (e.g., next 100x token). Keep the tone optimistic and assertive. End with CA: ${contractAddress}. Use only one hashtag (#${ticker}) and one emoji related to ${ticker}. Must be under 270 characters. Never use quotation marks.`,
      
      `You are a memecoin enthusiast. Write a message about ${ticker} (${description}) that focuses on building a sense of community. Highlight phrases like join the family or be part of the revolution. Use an inclusive and welcoming tone. End with CA: ${contractAddress}. Use only one hashtag (#${ticker}) and one emoji related to ${ticker}. Must be under 270 characters. Never use quotation marks.`,
      
      `You are a memecoin enthusiast. Write a meme-style message about ${ticker} (${description}) thats designed to go viral. Use popular meme formats or references to trending crypto jokes (e.g., wen moon or hodl). End with CA: ${contractAddress}. Use only one hashtag (#${ticker}) and one emoji related to ${ticker}. Must be under 270 characters. Never use quotation marks.`,
      
      `You are a memecoin enthusiast. Write a sarcastic and slightly mocking message about people who are sleeping on ${ticker} (${description}). The tone should be playful but edgy. End with CA: ${contractAddress}. Use only one hashtag (#${ticker}) and one emoji related to ${ticker}. Must be under 270 characters. Never use quotation marks.`,
      
      `You are a memecoin enthusiast. Write a high-pressure call-to-action message about ${ticker} (${description}). Use words like dont wait, act fast, or before its too late to create urgency. End with CA: ${contractAddress}. Use only one hashtag (#${ticker}) and one emoji related to ${ticker}. Must be under 270 characters. Never use quotation marks.`,
      
      `You are a memecoin enthusiast. Write a brief educational message about ${ticker} (${description}), explaining one unique feature or benefit it offers. Keep it simple and engaging. End with CA: ${contractAddress}. Use only one hashtag (#${ticker}) and one emoji related to ${ticker}. Must be under 270 characters. Never use quotation marks.`
    ];

    const prompt = prompts[Math.floor(Math.random() * prompts.length)];

    let retries = 4;
    let delay = 2000;

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