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

// Initialize Twitter.js client
const twitterClient = new Client({
  bearerToken: process.env.TWITTER_BEARER_TOKEN,
});

// Test Twitter.js initialization
(async () => {
  try {
    console.log('Initializing Twitter client...');
    await twitterClient.users.findUserByUsername('TwitterDev'); // Test API connection
    console.log('Twitter client initialized successfully.');
  } catch (error) {
    console.error('Error initializing Twitter client:', error.message);
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

  const postWithRetry = async (tweet, attempt = 1) => {
    try {
      const response = await twitterClient.tweets.create({ text: tweet });
      console.log('Tweet posted successfully:', response);
      return response.id;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        console.log(`Error posting tweet (attempt ${attempt}):`, error.message);
        console.log(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return postWithRetry(tweet, attempt + 1);
      }
      throw new Error(`Failed to post tweet after ${MAX_RETRIES} attempts: ${error.message}`);
    }
  };

  try {
    const fullTweet = formatTweet(tweetContent, hashtags);
    console.log(`Attempting to post tweet: "${fullTweet}"`);
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
      `Write an enthusiastic promotional message for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `The token symbol is ${ticker}.` : ""} Encourage readers to join in on the next big opportunity in crypto. Keep it under 280 characters with one hashtag.`,
      
      `Create a provocative message for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `Token symbol: ${ticker}.` : ""} Use a bold tone to urge action now. Keep it concise with one hashtag.`,
      
      `Write a supportive message for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `Known as ${ticker}.` : ""} Use a friendly tone. Highlight the potential, with one hashtag for the token symbol.`,
      
      `Draft a mysterious message for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `The token is ${ticker}.` : ""} Use a cryptic tone. Keep it concise with one hashtag.`,
      
      `Write an informative message promoting a memecoin with contract address ${contractAddress}. 
       The ticker is ${ticker}. Use a straightforward tone to share why people should check it out, under 280 characters with one hashtag.`
    ];

    const prompt = prompts[Math.floor(Math.random() * prompts.length)];

    let retries = 3;
    let delay = 2000;

    while (retries > 0) {
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'You must generate concise, clear messages suitable for Twitter.' },
            { role: 'user', content: prompt },
          ],
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
