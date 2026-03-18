# Bingo Game Telegram Mini App

This directory contains the Telegram mini-app implementation for the Bingo Game application. The mini-app allows users to play the Bingo game directly within Telegram, providing a convenient and seamless gaming experience.

## Features

- Telegram mini-app for playing Bingo
- Inline button that says "Start Playing"
- Admin panel integration for sending messages to Telegram users
- User account linking between web app and Telegram
- API endpoints for Telegram bot functionality
- Referral system for user acquisition and rewards

## Setup Instructions

1. **Configure Environment Variables**:
   Copy the `.env.example` file to `.env` and fill in the required variables:

   ```
   BOT_TOKEN=your_telegram_bot_token
   WEBAPP_URL=https://your-webapp-url.com
   API_BASE_URL=http://localhost:3000/api
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=password
   DB_NAME=bingo_db
   JWT_SECRET=your_jwt_secret
   JWT_EXPIRES_IN=7d
   PORT=3001
   ```

2. **Install Dependencies**:

   ```
   npm install
   ```

3. **Run Database Migrations**:

   ```
   node migrations/add-telegram-fields.js
   ```

4. **Start the Bot**:

   ```
   npm start
   ```

5. **Start the Mini App Server** (in a separate terminal):
   ```
   node server.js
   ```

## Bot Commands

- `/start` - Start the bot and get the main menu
- `/help` - Show help message and information

## Referral System

The Telegram bot includes a full-featured referral system that allows users to:

1. Generate and share unique referral links with friends
2. Track referral statistics (number of referred users and earnings)
3. Earn commission when referred users make their first deposit
4. Copy referral links for easy sharing

### How it Works

1. Each user is assigned a unique referral code when they register
2. Users can share their referral link via Telegram or other platforms
3. When a new user joins using a referral link and makes their first deposit, the referrer receives a bonus
4. The bonus amount is a percentage of the first deposit, configured in the referral settings
5. The referrer is automatically notified when they earn a referral bonus

### Referral System Setup

To set up the referral system, run the migration script:

```
node run-referral-migration.js
```

This will:

- Add referral fields to the users table
- Create the referral_earnings table
- Create the referral_settings table
- Generate referral codes for existing users

### Customizing Referral Settings

The default referral settings are:

- 10% bonus on first deposit
- Minimum deposit amount of 100 ETB

These can be modified directly in the database by updating the `referral_settings` table.

## API Endpoints

- `POST /api/telegram/send-message` - Send a message to a specific Telegram user
- `POST /api/telegram/broadcast` - Broadcast a message to all Telegram users
- `GET /api/telegram/users` - Get all users with Telegram IDs
- `POST /api/telegram/link-account` - Link a user account with Telegram
- `GET /api/telegram/user/:telegramId` - Get user details by Telegram ID
- `GET /api/telegram/user/:telegramId/games` - Get user's game history

## Admin Panel Integration

The Telegram mini-app is integrated with the main admin panel, allowing administrators to:

1. View a list of all Telegram users
2. Send messages to individual users or broadcast to all users
3. Track user engagement through the Telegram interface

### Local Admin Dashboard

A small admin dashboard is included in this repo and served from the bot/API server.

- Start the bot/API server:
  ```bash
  npm start
  ```
- Open the dashboard in your browser:
  ```
  http://localhost:5034/admin
  ```

Use the API key from your `.env` (the `API_KEY` value) to load users and send broadcasts.

## File Structure

- `index.js` - Main bot application file
- `server.js` - Mini app static file server
- `public/` - Static files for the mini app
- `config/` - Configuration files (database connection, etc.)
- `routes/` - API routes
- `migrations/` - Database migration scripts
  - `add-referral-system.js` - Referral system migration script

## Creating a Telegram Bot

To create a Telegram bot for this application:

1. Talk to the [BotFather](https://t.me/botfather) on Telegram
2. Use the `/newbot` command to create a new bot
3. Choose a name and username for your bot
4. Get the bot token and add it to your `.env` file
5. Use BotFather's `/setdomain` command to set the domain for your mini app

## Troubleshooting

- If the bot doesn't respond, check if the `BOT_TOKEN` is correct in the `.env` file
- If users can't access the mini app, verify that the `WEBAPP_URL` is correct and accessible
- For database connection issues, verify the database credentials in the `.env` file

### Common database issues (MySQL)

1. **Make sure MySQL is running**
   - On Windows, run PowerShell or Command Prompt as **Administrator** (required to start services).
   - Use Services (`services.msc`) or run:
     ```powershell
     net start MySQL
     ```
     or (if your MySQL service is named differently, for example `MySQL96`):
     ```powershell
     net start MySQL96
     ```
   - If you get `Access is denied`, you must run the command in an Administrator shell.
   - If MySQL is not installed, use Docker instead (see below).

2. **Run MySQL in Docker (recommended if you don't have MySQL installed)**
   - Start the database with:
     ```bash
     docker-compose up -d
     ```
   - This will launch MySQL 8 and create the `bingo_online4` database automatically.
   - The app is configured to connect using:
     - host: `localhost`
     - port: `3306`
     - user: `root`
     - password: `rootpassword`

3. **Confirm the database exists**
   - Use a MySQL client (Workbench, CLI) to confirm `bingo_online4` exists.
   - If it doesn't, create it and run migrations:
     ```bash
     mysql -u root -prootpassword -e "CREATE DATABASE IF NOT EXISTS bingo_online4;"
     node migrations/add-telegram-fields.js
     ```

4. **Check `.env` database settings**
   - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`

If the server logs `Error connecting to database: ECONNREFUSED`, it means the node server could not reach MySQL on the configured host/port.
