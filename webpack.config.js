const webpack = require('webpack');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

module.exports = {
  mode: process.env.NODE_ENV || 'development',
  entry: './kolagent.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js'
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        TWITTER_API_KEY: JSON.stringify(process.env.TWITTER_API_KEY),
        TWITTER_API_SECRET: JSON.stringify(process.env.TWITTER_API_SECRET),
        TWITTER_ACCESS_TOKEN: JSON.stringify(process.env.TWITTER_ACCESS_TOKEN),
        TWITTER_ACCESS_TOKEN_SECRET: JSON.stringify(process.env.TWITTER_ACCESS_TOKEN_SECRET),
        TWITTER_BEARER_TOKEN: JSON.stringify(process.env.TWITTER_BEARER_TOKEN),
        TWITTER_CLIENT_ID: JSON.stringify(process.env.TWITTER_CLIENT_ID),
        TWITTER_CLIENT_SECRET: JSON.stringify(process.env.TWITTER_CLIENT_SECRET),
        NODE_ENV: JSON.stringify(process.env.NODE_ENV)
      }
    })
  ]
}; 