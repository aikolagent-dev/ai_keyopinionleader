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

// Function to generate a random shill message
async function generateShillMessage(contractAddress) {
  try {
    const ticker = await getTokenTicker(contractAddress);

    // Array of different prompt styles
    const prompts = [
      `Write an enthusiastic promotional message for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `The token symbol is ${ticker}.` : ""} Encourage readers to join in on the next big opportunity in crypto, using upbeat language and fun emojis. Keep the message under 280 characters. Use one hashtag with the token symbol.`,

      `Create a provocative message for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `Token symbol: ${ticker}.` : ""} Be direct, for example "You missed all the major launches and are at a loss—are you really gonna miss this one too?" Use a bold tone to urge them to take action now. Keep the message concise, with one hashtag for the token symbol.`,

      `Write a supportive and welcoming message for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `Known as ${ticker}.` : ""} Use a friendly tone to make readers feel like they're joining an exciting community. Highlight the potential without heavy pressure. Keep it short and positive, with one hashtag for the token symbol.`,

      `Draft a mysterious and exclusive message for a memecoin with contract address ${contractAddress}. 
       ${ticker ? `The token is ${ticker}.` : ""} Make it sound like a hidden gem only a select few know about. Use a cryptic tone to spark curiosity. Keep it concise (under 260 characters) and add just one hashtag for the token symbol.`,
      
      `Write an informative message promoting a memecoin with contract address ${contractAddress}. 
       The ticker is ${ticker}. Use a straightforward tone to share what makes this token unique and why people should check it out. Keep it under 280 characters with one hashtag, which should be the token symbol.`
    ];

    // Select a random prompt
    const prompt = prompts[Math.floor(Math.random() * prompts.length)];

    let retries = 3;
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`KOLAgent server running on port ${PORT}`));
