require('dotenv').config();
const express = require('express');
const { TwitterApi } = require('twitter-api-v2');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
app.use(express.json());

// Initialize OpenAI and Twitter clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const twitterClient = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);

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

// Function to fetch the token ticker using Dexscreener API
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

// Function to generate a message using OpenAI with retry logic
async function generateShillMessage(contractAddress) {
  try {
    const ticker = await getTokenTicker(contractAddress);
    const prompt = `
      In under 280 characters, write a promotional message for a memecoin with contract address ${contractAddress}.
      ${ticker ? `The token symbol is ${ticker}.` : ""}
      Do not mention low fees and fast transactions. Use emojis which fit the ticker. Keep the message short and concise. Use a tone suitable for crypto enthusiasts. Only use one hashtag, the name of the token. 
    `;

    let retries = 3;
    let delay = 2000;

    while (retries > 0) {
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 100,
        });

        const shillMessage = response.choices[0].message.content.trim();
        console.log("Generated Shill Message:", shillMessage);

        await postOnTwitter(shillMessage);
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

// Function to post message on Twitter using API v2
async function postOnTwitter(message) {
  try {
    const { data: createdTweet } = await twitterClient.v2.tweet(message);
    console.log("Shill message posted on Twitter:", createdTweet);
  } catch (error) {
    console.error("Error posting on Twitter:", error.message);
  }
}

// Setting the port to use Heroku's dynamic port or default to 3000 for local development
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`KOLAgent server running on port ${PORT}`));
