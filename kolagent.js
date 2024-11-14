require('dotenv').config();
const express = require('express');
const { TwitterApi } = require('twitter-api-v2');
const OpenAI = require('openai');

const app = express();
app.use(express.json());

// Initialize OpenAI and Twitter clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// Webhook endpoint to receive transaction data from Helius
app.post('/webhook', async (req, res) => {
  const data = req.body;

  // Check if tokenTransfers data is available
  if (data[0]?.tokenTransfers && data[0].tokenTransfers.length > 0) {
    data[0].tokenTransfers.forEach(async (transfer) => {
      const contractAddress = transfer.mint;
      console.log(`Token Transfer Detected for token: ${contractAddress}`);

      // Generate and post a shill message
      await generateShillMessage(contractAddress);
    });
  } else {
    console.log("No token transfers found in this transaction.");
  }

  res.sendStatus(200); // Acknowledge receipt of the webhook
});

// Function to generate a message using OpenAI
async function generateShillMessage(contractAddress) {
  try {
    const prompt = `
      Write a promotional message for a Solana token with the contract address ${contractAddress}.
      Highlight why this token could be valuable.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
    });

    const shillMessage = response.choices[0].message.content.trim();
    console.log("Generated Shill Message:", shillMessage);

    // Post the message on Twitter
    await postOnTwitter(shillMessage);
  } catch (error) {
    console.error("Error generating shill message:", error);
  }
}

// Function to post message on Twitter
async function postOnTwitter(message) {
  try {
    await twitterClient.v1.tweet(message);
    console.log("Shill message posted on Twitter!");
  } catch (error) {
    console.error("Error posting on Twitter:", error);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`KOLAgent server running on port ${PORT}`));
