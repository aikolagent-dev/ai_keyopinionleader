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

// Initialize Twitter client (at the top level of your file)
const twitterClient = new Client({
  apiKey: process.env.TWITTER_API_KEY,
  apiSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});

// Log initial client state
console.log('Twitter Client Initialization:', {
  hasApiKey: !!twitterClient.apiKey,
  hasApiSecret: !!twitterClient.apiSecret,
  hasAccessToken: !!twitterClient.accessToken,
  hasAccessTokenSecret: !!twitterClient.accessTokenSecret
});

// Tweet posting function
async function postTweet(message) {
  console.log('Tweet attempt with credentials:', {
    hasApiKey: !!twitterClient.apiKey,
    hasApiSecret: !!twitterClient.apiSecret,
    hasAccessToken: !!twitterClient.accessToken,
    hasAccessTokenSecret: !!twitterClient.accessTokenSecret
  });

  try {
    const result = await twitterClient.v2.tweet({
      text: message
    });
    console.log('Tweet posted successfully:', result);
    return result;
  } catch (error) {
    console.error('Tweet error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      data: error.response?.data
    });
    throw error;
  }
}

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

app.post('/webhook', async (req, res) => {
  console.log('Webhook received:', {
    timestamp: new Date().toISOString(),
    bodyLength: JSON.stringify(req.body).length,
    hasData: !!req.body
  });

  try {
    // Extract contract address from the webhook data
    const webhookData = req.body[0];
    const contractAddress = webhookData?.accountData?.[0]?.account;

    console.log('Processing webhook data:', {
      accountDataCount: webhookData?.accountData?.length,
      firstAccount: contractAddress?.substring(0,8) + '...',
      tokenChanges: webhookData?.accountData?.[0]?.tokenBalanceChanges
    });

    if (!contractAddress) {
      throw new Error('No contract address found in webhook data');
    }

    // Generate shill message with the extracted contract address
    const shillMessage = `Unleash the crypto beast! Invest in ${contractAddress}. Your ticket to the moon! #MoonTicketCrypto\n\n#Crypto`;
    console.log('Generated message:', shillMessage);

    // Log Twitter client state before posting
    console.log('Twitter client state:', {
      hasApiKey: !!twitterClient.apiKey,
      hasApiSecret: !!twitterClient.apiSecret,
      hasAccessToken: !!twitterClient.accessToken,
      hasAccessTokenSecret: !!twitterClient.accessTokenSecret,
      clientInitialized: !!twitterClient
    });

    // Try to post tweet with retries
    let attempt = 1;
    const maxAttempts = 3;
    
    while (attempt <= maxAttempts) {
      try {
        console.log(`Tweet attempt ${attempt}/${maxAttempts}`);
        const tweet = await twitterClient.v2.tweet({
          text: shillMessage
        });
        console.log('Tweet posted successfully:', tweet);
        break;
      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, {
          name: error.name,
          message: error.message,
          code: error.code,
          response: error.response?.data,
          stack: error.stack
        });
        
        if (attempt === maxAttempts) {
          throw error;
        }
        
        const delay = attempt * 1000; // Increasing delay between retries
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt++;
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook handler error:', {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack,
      response: error.response?.data
    });
    res.status(500).send('Error processing webhook');
  }
});
