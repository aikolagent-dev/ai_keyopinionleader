import dotenv from 'dotenv';
import express from 'express';
import { Client } from 'twitter.js';
import OpenAI from 'openai';
import axios from 'axios';
import { TwitterApi } from 'twitter-api-v2';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Check if environment variables are available
if (!process.env.TWITTER_API_KEY || !process.env.TWITTER_API_SECRET) {
  console.error('Twitter credentials not found in environment');
}

// Initialize the client with your credentials
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

// Get the read-write client
const rwClient = twitterClient.readWrite;

// You can verify the authentication by logging the client type
console.log('Client type:', rwClient ? 'ReadWrite' : 'ReadOnly');

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
      `Write a direct, concise and mysterious message for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `The ticker is ${ticker}.` : ""}. Keep it under 280 characters with one hashtag.`,
    ];

    const prompt = prompts[0];

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
    });

    const shillMessage = response.choices[0].message.content.trim();
    console.log("Generated Shill Message:", shillMessage);

    await postTweet(shillMessage, [ticker || "Crypto"]);
  } catch (error) {
    console.error("Error generating shill message:", error.message);
  }
}

// Function to post message on Twitter using API v1.1
async function postOnTwitter(message) {
  try {
    const { data: createdTweet } = await rwClient.v1.tweet(message);
    console.log("Shill message posted on Twitter:", createdTweet);
  } catch (error) {
    console.error("Error posting on Twitter:", error.message);
    console.error("Full error:", {
      message: error.message,
      code: error.code,
      data: error.data,
      stack: error.stack
    });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`KOLAgent server running on port ${PORT}`));
