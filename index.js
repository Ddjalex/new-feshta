require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");

// Import routes
const telegramRoutes = require("./routes/telegramRoutes");
const paymentRoutes = require("./routes/paymentRoutes");

// Payment service for handling transactions
const paymentService = require("./services/paymentService");

// Use environment token (production) or fallback for local debugging
const BOT_TOKEN = process.env.BOT_TOKEN || "8427577528:AAF3z-O84R-oRALh5hiEJnUJWu5x5M-EnP0";

if (!BOT_TOKEN || BOT_TOKEN === "YOUR_BOT_TOKEN_HERE") {
  console.error("FATAL: TELEGRAM BOT_TOKEN is missing. Set BOT_TOKEN in .env or environment vars.");
  process.exit(1);
}

// Initialize Telegram bot with session
const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Set up bot commands menu in a safe initializer
(async () => {
  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "play", description: "🎮 Play Game" },
      { command: "winning_patterns", description: "🏆 Winning Patterns" },
      { command: "instructions", description: "📝 Game Instructions" },
      { command: "balance", description: "💰 Check Balance" },
      { command: "deposit", description: "💵 Deposit" },
      { command: "withdraw", description: "💸 Withdraw" },
      { command: "transactions", description: "📜 My Transactions" },
      { command: "referrals", description: "👥 Referrals" },
      { command: "referral_voucher", description: "🎟️ Referral Voucher" },
      { command: "contact_support", description: "📞 Contact Support" },
      { command: "help", description: "❓ Help" },
    ]);
    console.log("Bot commands initialized");
  } catch (err) {
    console.warn("Warning: Unable to initialize bot commands: ", err.message || err);
  }
})();

// Session data for users (store in memory)
const sessions = {};

// New utility function to safely send messages
const safeSendMessage = async (chatId, message, options = {}) => {
  try {
    return await bot.telegram.sendMessage(chatId, message, options);
  } catch (error) {
    if (
      error.description &&
      error.description.includes("bot was blocked by the user")
    ) {
      console.log(`User ${chatId} has blocked the bot, can't send message`);
      return null;
    }
    // Rethrow other errors
    throw error;
  }
};

// New utility function to safely use ctx.reply
const safeReply = async (ctx, message, options = {}) => {
  try {
    return await ctx.reply(message, options);
  } catch (error) {
    if (
      error.description &&
      error.description.includes("bot was blocked by the user")
    ) {
      console.log(
        `User ${ctx.from.id} has blocked the bot, can't send message`
      );
      return null;
    }
    console.error(`Error sending reply to ${ctx.from.id}:`, error);
    return null;
  }
};

// New utility function to safely send photos
const safeReplyWithPhoto = async (ctx, photo, options = {}) => {
  try {
    return await ctx.replyWithPhoto(photo, options);
  } catch (error) {
    if (
      error.description &&
      error.description.includes("bot was blocked by the user")
    ) {
      console.log(`User ${ctx.from.id} has blocked the bot, can't send photo`);
      return null;
    }
    console.error(`Error sending photo to ${ctx.from.id}:`, error);
    return null;
  }
};

// Make bot instance available to routes
app.set("botInstance", bot);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database connection
const db = require("./config/db");

// Import routes
const indexRoutes = require("./routes/index");

// Register routes
app.use("/api", indexRoutes);
app.use("/api/telegram", telegramRoutes);
app.use("/api/payment", paymentRoutes);

// Get user data from database by Telegram ID
const getUserByTelegramId = async (telegramId) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, username, phone_number, balance, telegram_id, isBlocked, blocked_reason FROM users WHERE telegram_id = ?",
      [telegramId]
    );

    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error("Error fetching user by Telegram ID:", error);
    return null;
  }
};

// New function to get user by phone number
const getUserByPhoneNumber = async (phoneNumber) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, username, phone_number, balance, telegram_id, isBlocked, blocked_reason FROM users WHERE phone_number = ?",
      [phoneNumber]
    );

    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error("Error fetching user by phone number:", error);
    return null;
  }
};

// Helper function to escape MarkdownV2 characters
const escapeMarkdownV2 = (text) => {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
};

// Helper function to check if user is blocked and handle response
const checkUserBlocked = async (ctx, telegramId) => {
  const user = await getUserByTelegramId(telegramId);

  if (!user) {
    return { isBlocked: false, user: null };
  }

  if (user.isBlocked === 1) {
    const reason = user.blocked_reason || "No reason provided";
    try {
      await safeReply(
        ctx,
        `❌ Your account has been blocked.\n\nReason: ${reason}\n\nPlease contact support for assistance.`
      );
    } catch (error) {
      console.error("Error sending blocked message:", error);
    }
    return { isBlocked: true, user };
  }

  return { isBlocked: false, user };
};

// Generate a random referral code for a user
const generateReferralCode = () => {
  return "REF" + Math.random().toString(36).substring(2, 10).toUpperCase();
};

// Process referral reward when a new user joins
const processReferralReward = async (userId) => {
  try {
    console.log(`Processing referral reward for user ID: ${userId}`);

    // Get the user's referrer
    const [userInfo] = await db.execute(
      "SELECT referred_by FROM users WHERE id = ?",
      [userId]
    );

    console.log("User info retrieved:", userInfo);

    if (!userInfo[0] || !userInfo[0].referred_by) {
      // No referrer, no reward
      console.log("No referrer found for user", userId);
      return { success: false, message: "No referrer" };
    }

    const referrerId = userInfo[0].referred_by;
    console.log(`Referrer ID: ${referrerId}`);

    // Check if referral reward was already given for this user
    const [existingReward] = await db.execute(
      "SELECT id FROM referral_earnings WHERE referrer_id = ? AND referred_id = ?",
      [referrerId, userId]
    );

    console.log("Existing reward check:", existingReward);

    if (existingReward && existingReward.length > 0) {
      // Reward already given
      console.log("Reward already given for this referral");
      return { success: false, message: "Reward already given" };
    }

    // Get referral settings
    const [settings] = await db.execute(
      "SELECT fixed_reward_amount, earnings_enabled FROM referral_settings WHERE id = 1"
    );

    console.log("Referral settings:", settings);

    if (!settings || settings.length === 0) {
      console.log("No referral settings found");
      return { success: false, message: "No referral settings" };
    }

    // Check if referral earnings are enabled
    if (
      settings[0].earnings_enabled === 0 ||
      settings[0].earnings_enabled === false
    ) {
      console.log("Referral earnings are disabled");
      return { success: false, message: "Referral earnings are disabled" };
    }

    // Use fixed reward amount
    const rewardAmount = parseFloat(settings[0].fixed_reward_amount) || 50; // Default to 50 if not set
    console.log(`Reward amount: ${rewardAmount}`);

    // Begin transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();
    console.log("Transaction started");

    try {
      // Create referral earning record
      console.log("Creating referral earning record");
      await connection.execute(
        "INSERT INTO referral_earnings (referrer_id, referred_id, amount, status, completed_at) VALUES (?, ?, ?, 'completed', NOW())",
        [referrerId, userId, rewardAmount]
      );

      // Update referrer's balance
      console.log("Updating referrer balance");
      await connection.execute(
        "UPDATE users SET balance = balance + ? WHERE id = ?",
        [rewardAmount, referrerId]
      );

      // Add transaction record
      console.log("Adding transaction record");
      await connection.execute(
        "INSERT INTO transactions (user_id, transaction_type, amount, status, reference_id) VALUES (?, 'commission', ?, 'completed', ?)",
        [referrerId, rewardAmount, `REFERRAL-${userId}`]
      );

      await connection.commit();
      console.log("Transaction committed successfully");

      return {
        success: true,
        message: "Referral reward processed",
        rewardAmount,
        referrerId,
      };
    } catch (error) {
      console.error("Error in referral reward transaction:", error);
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error processing referral reward:", error);
    return { success: false, message: "Server error", error: error.message };
  }
};

// Function to get user's referral data
const getUserReferralData = async (userId) => {
  try {
    // Get user's referral code
    const [userData] = await db.execute(
      "SELECT referral_code FROM users WHERE id = ?",
      [userId]
    );

    if (!userData || userData.length === 0) {
      return null;
    }

    let referralCode = userData[0].referral_code;

    // If no referral code exists, generate one
    if (!referralCode) {
      referralCode = generateReferralCode();

      // Update user with new referral code
      await db.execute("UPDATE users SET referral_code = ? WHERE id = ?", [
        referralCode,
        userId,
      ]);
    }

    // Get referral earnings
    const [earnings] = await db.execute(
      `SELECT 
        re.id, 
        re.amount, 
        re.status, 
        re.created_at,
        re.completed_at,
        u.username as referred_username
      FROM referral_earnings re
      JOIN users u ON re.referred_id = u.id
      WHERE re.referrer_id = ?
      ORDER BY re.created_at DESC`,
      [userId]
    );

    // Get referral settings
    const [settings] = await db.execute(
      "SELECT fixed_reward_amount FROM referral_settings WHERE id = 1"
    );

    // Get count of referred users
    const [referredCount] = await db.execute(
      "SELECT COUNT(*) as count FROM users WHERE referred_by = ?",
      [userId]
    );

    // Calculate total earnings
    let totalEarnings = 0;
    if (earnings.length > 0) {
      totalEarnings = earnings.reduce(
        (sum, earning) => sum + parseFloat(earning.amount),
        0
      );
    }

    return {
      referralCode,
      referralLink: `https://t.me/${bot.botInfo.username}?start=ref_${referralCode}`,
      totalEarnings,
      totalReferred: referredCount[0].count,
      earnings,
      settings: settings[0] || {
        fixed_reward_amount: 50,
      },
    };
  } catch (error) {
    console.error("Error getting referral info:", error);
    return null;
  }
};

// Updated welcome message and start command handler with the exact original menu items
bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const firstName = ctx.from.first_name;

  // Check if this is a referral link click
  const startPayload = ctx.startPayload || "";
  let referralCode = null;

  console.log(`Start payload: "${startPayload}"`);

  if (startPayload.startsWith("ref_")) {
    referralCode = startPayload.substring(4);
    console.log(`Extracted referral code: ${referralCode}`);
  } else if (startPayload) {
    // Try to use the payload directly as a referral code
    console.log(
      `Trying to use payload directly as referral code: ${startPayload}`
    );
    referralCode = startPayload;
  }

  try {
    // Check if user already exists
    const { isBlocked, user } = await checkUserBlocked(ctx, telegramId);

    if (isBlocked) {
      return; // User is blocked, message already sent by checkUserBlocked
    }

    if (user) {
      // User already exists, send normal welcome message
      await safeReplyWithPhoto(ctx, { source: "./public/welcome.jpg" });
      await safeReply(ctx, `Welcome to Feshta Bingo! Choose an option below.`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🎮 Play Game", callback_data: "play_game" },
              {
                text: "🏆 Winning Patterns",
                callback_data: "winning_patterns",
              },
            ],
            [
              { text: "📝 Game Instructions", callback_data: "instructions" },
              { text: "💰 My Balance", callback_data: "check_balance" },
            ],
            [
              { text: "💵 Deposit", callback_data: "deposit" },
              { text: "💸 Withdraw", callback_data: "withdraw" },
            ],
            [
              { text: "📜 My Transactions", callback_data: "transactions" },
              { text: "👥 Referrals", callback_data: "referrals" },
            ],
            [
              // { text: "💸 Transfer", callback_data: "transfer" },
              {
                text: "🎟️ Referral Voucher",
                callback_data: "referral_voucher",
              },
            ],
            [
              { text: "📞 Contact Support", callback_data: "contact_support" },
              { text: "❓ Help", callback_data: "help" },
            ],
          ],
        },
      });
    } else {
      // Store referral code in session if available
      if (referralCode) {
        console.log(
          `Storing referral code ${referralCode} for user ${telegramId}`
        );
        sessions[telegramId] = {
          ...(sessions[telegramId] || {}),
          referralCode,
        };
      } else {
        console.log(`No referral code in start payload for user ${telegramId}`);
      }

      // New user, request phone number
      await safeReply(
        ctx,
        `Welcome ${firstName}! To get started, please share your phone number.`,
        {
          reply_markup: {
            keyboard: [
              [{ text: "📱 Share My Phone Number", request_contact: true }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
    }
  } catch (error) {
    console.error("Error in start command:", error);
    await safeReply(
      ctx,
      "Sorry, something went wrong. Please try again later."
    );
  }
});

// Add callback handler for Demo Game
bot.on("callback_query", async (ctx) => {
  const action = ctx.callbackQuery.data;
  const telegramId = ctx.from.id;
  const sessionData = sessions[telegramId] || {};

  try {
    // Check if user is blocked before processing any action
    const { isBlocked } = await checkUserBlocked(ctx, telegramId);

    if (isBlocked) {
      await ctx.answerCbQuery("Your account is blocked");
      return; // User is blocked, message already sent by checkUserBlocked
    }

    // Handle main menu buttons - making sure they match command functionality exactly
    if (action === "play_game") {
      // Mirror exactly what the /play command does
      await ctx.answerCbQuery();
      const webappUrl = `${process.env.WEBAPP_URL}?tgUserId=${telegramId}`;

      await safeReply(
        ctx,
        "Let's play Bingo! Click the button below to start the game:",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🎮 Start Playing",
                  web_app: { url: webappUrl },
                },
              ],
            ],
          },
        }
      );
    } else if (action === "winning_patterns") {
      await ctx.answerCbQuery();
      try {
        await safeReplyWithPhoto(
          ctx,
          { source: "./public/pattern.jpg" },
          {
            caption:
              "These are the possible winning patterns in our Bingo game.",
          }
        );
      } catch (error) {
        console.error("Error sending winning patterns:", error);
        safeReply(
          ctx,
          "Sorry, there was an error showing the winning patterns."
        );
      }
    } else if (action === "instructions") {
      await ctx.answerCbQuery();
      const instructions = `
📝 <b>How to Play Feshta Bingo</b>

1️⃣ <b>Buy a Card:</b> Purchase a bingo card with numbers arranged in a 5x5 grid.

2️⃣ <b>Number Calling:</b> Numbers will be randomly called during the game.

3️⃣ <b>Mark Your Card:</b> If a called number appears on your card, tap it to mark it.

4️⃣ <b>Winning Patterns:</b> Complete one of the winning patterns (horizontal, vertical, diagonal, or special patterns).

5️⃣ <b>Call Bingo:</b> Once you complete a pattern, the system will automatically recognize your win!

6️⃣ <b>Prizes:</b> Winners receive prizes based on the game's prize pool.

Good luck and have fun playing! 🍀
`;

      await safeReply(ctx, instructions, { parse_mode: "HTML" });
    } else if (action === "check_balance") {
      // Mirror exactly what the /balance command does
      await ctx.answerCbQuery();
      try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
          await safeReply(
            ctx,
            "Your account is not linked. Please play the game first to create an account.",
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Register ��", callback_data: "register" }],
                ],
              },
            }
          );
          return;
        }
        await safeReply(ctx, `Your current balance is: ${user.balance} ETB`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Play 🎮", callback_data: "play_game" },
                { text: "Deposit 💵", callback_data: "deposit" },
              ],
            ],
          },
        });
      } catch (error) {
        console.error("Error handling balance request:", error);
        safeReply(ctx, "Sorry, there was an error. Please try again later.");
      }
    } else if (action === "deposit") {
      // Mirror exactly what the /deposit command does
      await ctx.answerCbQuery();
      try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
          await safeReply(
            ctx,
            "Your account is not linked. Please play the game first to create an account.",
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Register 📝", callback_data: "register" }],
                ],
              },
            }
          );
          return;
        }

        // Get minimum deposit amount to inform user
        const settings = await paymentService.getGameSettings();
        const minDeposit = settings.min_deposit_amount;

        // Start deposit flow
        sessions[telegramId] = { depositState: "method" };

        let depositMessage = "Please select your payment method:";
        if (minDeposit > 0) {
          depositMessage = `Minimum deposit amount is ${minDeposit} ETB.\n\n${depositMessage}`;
        }

        await safeReply(ctx, depositMessage, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Telebirr", callback_data: "deposit_telebirr" },
                { text: "CBE", callback_data: "deposit_cbe" },
              ],
              [{ text: "Cancel", callback_data: "cancel_deposit" }],
            ],
          },
        });
      } catch (error) {
        console.error("Error handling deposit:", error);
        safeReply(ctx, "Sorry, there was an error. Please try again later.");
      }
    } else if (action === "withdraw") {
      // Mirror exactly what the /withdraw command does
      await ctx.answerCbQuery();
      try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
          await safeReply(
            ctx,
            "Your account is not linked. Please play the game first to create an account.",
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Register 📝", callback_data: "register" }],
                ],
              },
            }
          );
          return;
        }
        if (user.balance <= 0) {
          await safeReply(
            ctx,
            `You don't have enough balance to withdraw. Current balance: ${user.balance} ETB`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "Play 🎮", callback_data: "play_game" },
                    { text: "Deposit 💵", callback_data: "deposit" },
                  ],
                ],
              },
            }
          );
          return;
        }

        // Check if user meets the minimum wins requirement
        const winsCheck = await paymentService.checkUserWins(user.id);
        if (!winsCheck.allowed) {
          await safeReply(
            ctx,
            `You need to win at least ${winsCheck.required} games before you can withdraw. You have won ${winsCheck.wins} games so far.`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Play 🎮", callback_data: "play_game" }],
                ],
              },
            }
          );
          return;
        }

        sessions[telegramId] = { withdrawState: "method" };
        await safeReply(
          ctx,
          `Your current balance is ${user.balance} ETB.\n\nPlease select your withdrawal method:`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "Telebirr", callback_data: "withdraw_telebirr" },
                  { text: "CBE", callback_data: "withdraw_cbe" },
                ],
                [{ text: "Cancel", callback_data: "cancel_withdraw" }],
              ],
            },
          }
        );
      } catch (error) {
        console.error("Error handling withdraw:", error);
        safeReply(ctx, "Sorry, there was an error. Please try again later.");
      }
    } else if (action === "transactions") {
      // Mirror exactly what the /transactions command does
      await ctx.answerCbQuery();
      try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
          await safeReply(
            ctx,
            "Your account is not linked. Please play the game first to create an account.",
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Register 📝", callback_data: "register" }],
                ],
              },
            }
          );
          return;
        }
        const transactions = await paymentService.getUserTransactions(
          user.id,
          5
        );
        if (transactions.length === 0) {
          await safeReply(ctx, "You don't have any transactions yet.");
          return;
        }
        let message = "📜 Your Recent Transactions:\n\n";
        transactions.forEach((txn, index) => {
          const txnType =
            txn.transaction_type.charAt(0).toUpperCase() +
            txn.transaction_type.slice(1);
          const status =
            txn.actual_status.charAt(0).toUpperCase() +
            txn.actual_status.slice(1);
          const date = new Date(txn.created_at).toLocaleDateString();
          const sign = txn.amount > 0 ? "+" : "";
          message += `${index + 1}. ${txnType}: ${sign}${txn.amount} ETB\n`;
          message += `   Status: ${status}\n`;
          message += `   Date: ${date}\n`;
          if (txn.transaction_number) {
            message += `   Reference: ${txn.transaction_number}\n`;
          }
          message += "\n";
        });
        await safeReply(ctx, message, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Play 🎮", callback_data: "play_game" },
                { text: "Deposit 💵", callback_data: "deposit" },
              ],
            ],
          },
        });
      } catch (error) {
        console.error("Error handling transactions request:", error);
        safeReply(ctx, "Sorry, there was an error. Please try again later.");
      }
    } else if (action === "referral_voucher") {
      await ctx.answerCbQuery();

      // Check if user exists
      const user = await getUserByTelegramId(telegramId);
      if (!user) {
        await safeReply(
          ctx,
          "Your account is not linked. Please play the game first to create an account.",
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "Register 📝", callback_data: "register" }],
              ],
            },
          }
        );
        return;
      }

      // Start voucher claim process
      sessions[telegramId] = { voucherState: "awaiting_code" };
      await safeReply(ctx, "Please enter your voucher code to claim:");
    } else if (action === "contact_support") {
      await ctx.answerCbQuery();

      try {
        // Get contact information from database
        const contacts = await getContactInformation();

        let supportMessage = `
📞 <b>Contact Support</b>

Need help? Contact our support team:
`;

        if (contacts && contacts.length > 0) {
          // Add each contact to the message
          contacts.forEach((contact) => {
            const icon = getContactIcon(contact.contact_type);
            supportMessage += `\n${icon} ${
              contact.description || capitalizeFirstLetter(contact.contact_type)
            }: ${contact.contact_value}`;
          });
        } else {
          // Fallback to default if no contacts found
          supportMessage += `
🔹 Telegram: @feshtabingosupport
🔹 Phone: 0900000000
`;
        }

        supportMessage += `\nWe're here to help you with any questions or issues!`;

        await safeReply(ctx, supportMessage, { parse_mode: "HTML" });
      } catch (error) {
        console.error("Error retrieving contact information:", error);
        // Fallback to default message
        await safeReply(
          ctx,
          `
📞 <b>Contact Support</b>

Need help? Contact our support team:

�� Telegram: @feshtabingosupport
🔹 Phone: 0900000000

We're here to help you with any questions or issues!
        `,
          { parse_mode: "HTML" }
        );
      }
    } else if (action === "help") {
      // Mirror exactly what the /help command does
      await ctx.answerCbQuery();
      await safeReply(
        ctx,
        `
🎮 <b>Bingo Game Bot Help</b> 🎲

Available commands:
• /start - Start the bot
• /play - Start playing Bingo
• /winning_patterns - View winning patterns
• /instructions - Game instructions
• /balance - Check your current balance
• /deposit - Add funds to your account
• /withdraw - Withdraw funds from your account
• /transfer - Transfer funds to another user
• /transactions - View your recent transactions
• /referrals - Manage your referrals and earn bonuses
• /referral_voucher - Claim a referral voucher
• /contact_support - Get support contact information
• /help - Show this help message

Need further assistance? Contact support at support@Feshtabingo.com
        `,
        { parse_mode: "HTML" }
      );
    } else if (action === "referrals") {
      // Mirror exactly what the /referrals command does
      await ctx.answerCbQuery();
      try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
          await safeReply(
            ctx,
            "Please create an account first by using the /start command.",
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Register 📝", callback_data: "register" }],
                ],
              },
            }
          );
          return;
        }
        const referralData = await getUserReferralData(user.id);
        if (!referralData) {
          await safeReply(
            ctx,
            "Unable to retrieve referral information. Please try again later."
          );
          return;
        }
        let message = `🔗 <b>Your Referral Link</b>\n${referralData.referralLink}\n\n`;
        message += `🎁 <b>Referral Reward</b>: ${referralData.settings.fixed_reward_amount} ETB for each new user\n\n`;
        message += `👥 <b>Total Referred</b>: ${referralData.totalReferred}\n`;
        message += `💵 <b>Total Earnings</b>: ${referralData.totalEarnings} ETB\n\n`;
        if (referralData.earnings.length > 0) {
          message += `<b>Recent Earnings:</b>\n`;
          const recentEarnings = referralData.earnings.slice(0, 5);
          recentEarnings.forEach((earning) => {
            const date = new Date(earning.created_at).toLocaleDateString();
            message += `- ${earning.amount} ETB from @${earning.referred_username} (${date})\n`;
          });
        } else {
          message += `<b>Share your referral link to earn rewards!</b>\n`;
          message += `When someone joins using your link, you'll earn ${referralData.settings.fixed_reward_amount} ETB immediately.`;
        }
        await safeReply(ctx, message, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📋 Copy Referral Link",
                  callback_data: "copy_referral_link",
                },
              ],
            ],
          },
        });
      } catch (error) {
        console.error("Error retrieving referral data:", error);
        safeReply(
          ctx,
          "Sorry, there was an error retrieving your referral information. Please try again later."
        );
      }
    }
    // Deposit flow callbacks
    else if (action === "deposit_telebirr") {
      sessions[telegramId] = {
        ...sessionData,
        depositMethod: "telebirr",
        depositState: "amount",
      };
      await ctx.answerCbQuery();
      await safeReply(
        ctx,
        "Please enter the amount you want to deposit in ETB:"
      );
    } else if (action === "deposit_cbe") {
      sessions[telegramId] = {
        ...sessionData,
        depositMethod: "cbe",
        depositState: "amount",
      };
      await ctx.answerCbQuery();
      await safeReply(
        ctx,
        "Please enter the amount you want to deposit in ETB:"
      );
    } else if (action === "cancel_deposit") {
      delete sessions[telegramId];
      await ctx.answerCbQuery();
      await safeReply(ctx, "Deposit process cancelled.");
      // Send the main menu again
      await safeReply(ctx, "Welcome to Feshta Bingo! Choose an option below.", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🎮 Play Game", callback_data: "play_game" },
              {
                text: "🏆 Winning Patterns",
                callback_data: "winning_patterns",
              },
            ],
            [
              { text: "📝 Game Instructions", callback_data: "instructions" },
              { text: "💰 My Balance", callback_data: "check_balance" },
            ],
            [
              { text: "💵 Deposit", callback_data: "deposit" },
              { text: "💸 Withdraw", callback_data: "withdraw" },
            ],
            [
              { text: "📜 My Transactions", callback_data: "transactions" },
              { text: "👥 Referrals", callback_data: "referrals" },
            ],
            [
              {
                text: "🎟️ Referral Voucher",
                callback_data: "referral_voucher",
              },
              { text: "📞 Contact Support", callback_data: "contact_support" },
            ],
            [{ text: "❓ Help", callback_data: "help" }],
          ],
        },
      });
    }
    // Withdrawal flow callbacks
    else if (action === "withdraw_telebirr") {
      sessions[telegramId] = {
        ...sessionData,
        withdrawMethod: "telebirr",
        withdrawState: "amount",
      };
      await ctx.answerCbQuery();
      await safeReply(
        ctx,
        "Please enter the amount you want to withdraw in ETB:"
      );
    } else if (action === "withdraw_cbe") {
      sessions[telegramId] = {
        ...sessionData,
        withdrawMethod: "cbe",
        withdrawState: "amount",
      };
      await ctx.answerCbQuery();
      await safeReply(
        ctx,
        "Please enter the amount you want to withdraw in ETB:"
      );
    } else if (action === "cancel_withdraw") {
      delete sessions[telegramId];
      await ctx.answerCbQuery();
      await safeReply(ctx, "Withdrawal process cancelled.");
      // Send the main menu again
      await safeReply(ctx, "Welcome to Feshta Bingo! Choose an option below.", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🎮 Play Game", callback_data: "play_game" },
              {
                text: "🏆 Winning Patterns",
                callback_data: "winning_patterns",
              },
            ],
            [
              { text: "📝 Game Instructions", callback_data: "instructions" },
              { text: "💰 My Balance", callback_data: "check_balance" },
            ],
            [
              { text: "💵 Deposit", callback_data: "deposit" },
              { text: "💸 Withdraw", callback_data: "withdraw" },
            ],
            [
              { text: "📜 My Transactions", callback_data: "transactions" },
              { text: "👥 Referrals", callback_data: "referrals" },
            ],
            [
              {
                text: "🎟️ Referral Voucher",
                callback_data: "referral_voucher",
              },
              { text: "📞 Contact Support", callback_data: "contact_support" },
            ],
            [{ text: "❓ Help", callback_data: "help" }],
          ],
        },
      });
    } else if (action === "confirm_withdraw") {
      await ctx.answerCbQuery();

      const user = await getUserByTelegramId(telegramId);
      if (!user) {
        await safeReply(
          ctx,
          "Your account is not linked. Please play the game first to create an account.",
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "Register 📝", callback_data: "register" }],
              ],
            },
          }
        );
        return;
      }

      const { withdrawAmount, withdrawMethod, withdrawAccount, withdrawName } =
        sessions[telegramId];

      const result = await paymentService.createWithdrawalRequest(
        user.id,
        withdrawAmount,
        withdrawMethod,
        withdrawAccount,
        withdrawName
      );

      if (result.success) {
        await safeReply(
          ctx,
          `✅ Your withdrawal request for ${withdrawAmount} ETB has been submitted successfully!\n\nNew balance: ${result.newBalance} ETB\n\nYour request is now pending approval by our team. You'll be notified once it's processed.`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "🎮 Play Game", callback_data: "play_game" },
                  {
                    text: "🏆 Winning Patterns",
                    callback_data: "winning_patterns",
                  },
                ],
                [
                  {
                    text: "📝 Game Instructions",
                    callback_data: "instructions",
                  },
                  { text: "💰 My Balance", callback_data: "check_balance" },
                ],
                [
                  { text: "💵 Deposit", callback_data: "deposit" },
                  { text: "💸 Withdraw", callback_data: "withdraw" },
                ],
                [
                  { text: "📜 My Transactions", callback_data: "transactions" },
                  { text: "👥 Referrals", callback_data: "referrals" },
                ],
                [
                  {
                    text: "🎟️ Referral Voucher",
                    callback_data: "referral_voucher",
                  },
                  {
                    text: "📞 Contact Support",
                    callback_data: "contact_support",
                  },
                ],
                [{ text: "❓ Help", callback_data: "help" }],
              ],
            },
          }
        );
      } else {
        await safeReply(
          ctx,
          `❌ Failed to submit withdrawal request: ${result.message}`
        );
      }

      delete sessions[telegramId];

      // Show the main menu
      await safeReply(ctx, "What would you like to do next?", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🎮 Play Game", callback_data: "play_game" },
              {
                text: "🏆 Winning Patterns",
                callback_data: "winning_patterns",
              },
            ],
            [
              { text: "📝 Game Instructions", callback_data: "instructions" },
              { text: "💰 My Balance", callback_data: "check_balance" },
            ],
            [
              { text: "💵 Deposit", callback_data: "deposit" },
              { text: "💸 Withdraw", callback_data: "withdraw" },
            ],
            [
              { text: "📜 My Transactions", callback_data: "transactions" },
              { text: "👥 Referrals", callback_data: "referrals" },
            ],
            [
              {
                text: "🎟️ Referral Voucher",
                callback_data: "referral_voucher",
              },
              { text: "📞 Contact Support", callback_data: "contact_support" },
            ],
            [{ text: "❓ Help", callback_data: "help" }],
          ],
        },
      });
    } else if (action === "transfer") {
      await ctx.answerCbQuery();
      try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
          await safeReply(
            ctx,
            "Your account is not linked. Please play the game first to create an account.",
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Register 📝", callback_data: "register" }],
                ],
              },
            }
          );
          return;
        }

        if (user.balance <= 0) {
          await safeReply(
            ctx,
            `You don't have enough balance to transfer. Current balance: ${user.balance} ETB`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "Play 🎮", callback_data: "play_game" },
                    { text: "Deposit 💵", callback_data: "deposit" },
                  ],
                ],
              },
            }
          );
          return;
        }

        // Start transfer flow
        sessions[telegramId] = { transferState: "phone" };
        await safeReply(
          ctx,
          `Your current balance is ${user.balance} ETB.\n\nPlease enter the phone number of the user you want to transfer to (e.g., 091111111111):`
        );
      } catch (error) {
        console.error("Error handling transfer:", error);
        safeReply(ctx, "Sorry, there was an error. Please try again later.");
      }
    } else if (action === "confirm_transfer") {
      await ctx.answerCbQuery();

      try {
        const sessionData = sessions[telegramId];
        const { transferAmount, transferTargetUser } = sessionData;

        if (!transferAmount || !transferTargetUser) {
          await safeReply(ctx, "Transfer session expired. Please start over.");
          delete sessions[telegramId];
          return;
        }

        // Get current user
        const user = await getUserByTelegramId(telegramId);

        // Double-check balance
        if (transferAmount > user.balance) {
          await safeReply(ctx, "Insufficient balance for transfer.");
          delete sessions[telegramId];
          return;
        }

        // Begin transaction
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
          // Deduct from sender
          await connection.execute(
            "UPDATE users SET balance = balance - ? WHERE id = ?",
            [transferAmount, user.id]
          );

          // Add to receiver
          await connection.execute(
            "UPDATE users SET balance = balance + ? WHERE id = ?",
            [transferAmount, transferTargetUser.id]
          );

          // Add transaction records
          await connection.execute(
            "INSERT INTO transactions (user_id, transaction_type, amount, status, reference_id) VALUES (?, 'transfer_out', ?, 'completed', ?)",
            [user.id, -transferAmount, `TRANSFER-TO-${transferTargetUser.id}`]
          );

          await connection.execute(
            "INSERT INTO transactions (user_id, transaction_type, amount, status, reference_id) VALUES (?, 'transfer_in', ?, 'completed', ?)",
            [transferTargetUser.id, transferAmount, `TRANSFER-FROM-${user.id}`]
          );

          await connection.commit();

          // Notify sender
          await safeReply(
            ctx,
            `✅ Transfer successful!\n\nAmount: ${transferAmount} ETB\nTo: ${
              transferTargetUser.username
            }\nNew balance: ${user.balance - transferAmount} ETB`
          );

          // Notify receiver if they have telegram_id
          if (transferTargetUser.telegram_id) {
            try {
              await safeSendMessage(
                transferTargetUser.telegram_id,
                `💰 You received a transfer of ${transferAmount} ETB from ${user.username}!`
              );
            } catch (error) {
              console.error("Error notifying transfer recipient:", error);
            }
          }
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }

        delete sessions[telegramId];

        // Show the main menu
        await safeReply(ctx, "What would you like to do next?", {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🎮 Play Game", callback_data: "play_game" },
                {
                  text: "🏆 Winning Patterns",
                  callback_data: "winning_patterns",
                },
              ],
              [
                { text: "📝 Game Instructions", callback_data: "instructions" },
                { text: "💰 My Balance", callback_data: "check_balance" },
              ],
              [
                { text: "💵 Deposit", callback_data: "deposit" },
                { text: "💸 Withdraw", callback_data: "withdraw" },
              ],
              [
                { text: "📜 My Transactions", callback_data: "transactions" },
                { text: "👥 Referrals", callback_data: "referrals" },
              ],
              [
                { text: "💸 Transfer", callback_data: "transfer" },
                {
                  text: "🎟️ Referral Voucher",
                  callback_data: "referral_voucher",
                },
              ],
              [
                {
                  text: "📞 Contact Support",
                  callback_data: "contact_support",
                },
                { text: "❓ Help", callback_data: "help" },
              ],
            ],
          },
        });
      } catch (error) {
        console.error("Error processing transfer:", error);
        await safeReply(ctx, "❌ Transfer failed. Please try again later.");
        delete sessions[telegramId];
      }
    } else if (action === "cancel_transfer") {
      await ctx.answerCbQuery();
      await safeReply(ctx, "Transfer cancelled.");
      delete sessions[telegramId];

      // Show the main menu
      await safeReply(ctx, "What would you like to do next?", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🎮 Play Game", callback_data: "play_game" },
              {
                text: "🏆 Winning Patterns",
                callback_data: "winning_patterns",
              },
            ],
            [
              { text: "📝 Game Instructions", callback_data: "instructions" },
              { text: "💰 My Balance", callback_data: "check_balance" },
            ],
            [
              { text: "💵 Deposit", callback_data: "deposit" },
              { text: "💸 Withdraw", callback_data: "withdraw" },
            ],
            [
              { text: "📜 My Transactions", callback_data: "transactions" },
              { text: "👥 Referrals", callback_data: "referrals" },
            ],
            [
              { text: "💸 Transfer", callback_data: "transfer" },
              {
                text: "🎟️ Referral Voucher",
                callback_data: "referral_voucher",
              },
            ],
            [
              { text: "📞 Contact Support", callback_data: "contact_support" },
              { text: "❓ Help", callback_data: "help" },
            ],
          ],
        },
      });
    } else if (action === "copy_referral_link") {
      const telegramId = ctx.from.id;

      try {
        // Get user data
        const user = await getUserByTelegramId(telegramId);

        if (!user) {
          await ctx.answerCbQuery("Please create an account first.");
          return;
        }

        // Get referral data
        const referralData = await getUserReferralData(user.id);

        if (!referralData) {
          await ctx.answerCbQuery("Unable to retrieve referral link.");
          return;
        }

        // Send the link as a separate message for easy copying
        await ctx.answerCbQuery("Referral link ready to copy!");
        await safeReply(ctx, referralData.referralLink);
      } catch (error) {
        console.error("Error copying referral link:", error);
        await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
      }
    }
  } catch (error) {
    console.error("Error handling callback query:", error);
    safeReply(ctx, "Sorry, there was an error. Please try again later.");
  }
});

// Handle web app data
bot.on("web_app_data", async (ctx) => {
  const data = ctx.webAppData.data;

  try {
    // Process data from web app
    const parsedData = JSON.parse(data);

    // Example: handle game results
    if (parsedData.type === "game_result") {
      await safeReply(
        ctx,
        `Game Results:\nScore: ${parsedData.score}\nWin: ${
          parsedData.win ? "Yes" : "No"
        }`
      );
    }
  } catch (error) {
    console.error("Error processing web app data:", error);
    safeReply(ctx, "Sorry, there was an error processing your game data.");
  }
});

// Add transfer command
bot.command("transferrr", async (ctx) => {
  const telegramId = ctx.from.id;

  // Check if user is blocked
  const { isBlocked } = await checkUserBlocked(ctx, telegramId);
  if (isBlocked) {
    return; // User is blocked, message already sent by checkUserBlocked
  }

  try {
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      await safeReply(
        ctx,
        "Your account is not linked. Please play the game first to create an account.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Register 📝", callback_data: "register" }],
            ],
          },
        }
      );
      return;
    }

    if (user.balance <= 0) {
      await safeReply(
        ctx,
        `You don't have enough balance to transfer. Current balance: ${user.balance} ETB`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Play 🎮", callback_data: "play_game" },
                { text: "Deposit 💵", callback_data: "deposit" },
              ],
            ],
          },
        }
      );
      return;
    }

    // Start transfer flow
    sessions[telegramId] = { transferState: "phone" };
    await safeReply(
      ctx,
      `Your current balance is ${user.balance} ETB.\n\nPlease enter the phone number of the user you want to transfer to (e.g., 091111111111):`
    );
  } catch (error) {
    console.error("Error handling transfer:", error);
    safeReply(ctx, "Sorry, there was an error. Please try again later.");
  }
});

// Add command handlers for menu items
bot.command("play", async (ctx) => {
  const telegramId = ctx.from.id;

  // Check if user is blocked
  const { isBlocked } = await checkUserBlocked(ctx, telegramId);
  if (isBlocked) {
    return; // User is blocked, message already sent by checkUserBlocked
  }

  const webappUrl = `${process.env.WEBAPP_URL}?tgUserId=${telegramId}`;

  await safeReply(
    ctx,
    "Let's play Bingo! Click the button below to start the game:",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🎮 Start Playing",
              web_app: { url: webappUrl },
            },
          ],
        ],
      },
    }
  );
});

bot.command("winning_patterns", async (ctx) => {
  // Check if user is blocked
  const { isBlocked } = await checkUserBlocked(ctx, ctx.from.id);
  if (isBlocked) {
    return; // User is blocked, message already sent by checkUserBlocked
  }

  try {
    await safeReplyWithPhoto(
      ctx,
      { source: "./public/pattern.jpg" },
      {
        caption: "These are the possible winning patterns in our Bingo game.",
      }
    );
  } catch (error) {
    console.error("Error sending winning patterns:", error);
    safeReply(ctx, "Sorry, there was an error showing the winning patterns.");
  }
});

bot.command("instructions", async (ctx) => {
  // Check if user is blocked
  const { isBlocked } = await checkUserBlocked(ctx, ctx.from.id);
  if (isBlocked) {
    return; // User is blocked, message already sent by checkUserBlocked
  }

  const instructions = `
📝 <b>How to Play Feshta Bingo</b>

1️⃣ <b>Buy a Card:</b> Purchase a bingo card with numbers arranged in a 5x5 grid.

2️⃣ <b>Number Calling:</b> Numbers will be randomly called during the game.

3️⃣ <b>Mark Your Card:</b> If a called number appears on your card, tap it to mark it.

4️⃣ <b>Winning Patterns:</b> Complete one of the winning patterns (horizontal, vertical, diagonal, or special patterns).

5️⃣ <b>Call Bingo:</b> Once you complete a pattern, the system will automatically recognize your win!

6️⃣ <b>Prizes:</b> Winners receive prizes based on the game's prize pool.

Good luck and have fun playing! 🍀
`;

  await safeReply(ctx, instructions, { parse_mode: "HTML" });
});

bot.command("balance", async (ctx) => {
  const telegramId = ctx.from.id;

  // Check if user is blocked
  const { isBlocked } = await checkUserBlocked(ctx, telegramId);
  if (isBlocked) {
    return; // User is blocked, message already sent by checkUserBlocked
  }

  try {
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      try {
        await safeReply(
          ctx,
          "Your account is not linked. Please play the game first to create an account.",
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "Register 📝", callback_data: "register" }],
              ],
            },
          }
        );
      } catch (error) {
        if (
          error.description &&
          error.description.includes("bot was blocked by the user")
        ) {
          console.log(`User ${telegramId} has blocked the bot`);
        } else {
          console.error("Error sending account not linked message:", error);
        }
      }
      return;
    }

    try {
      await safeReply(ctx, `Your current balance is: ${user.balance} ETB`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Play ��", callback_data: "play_game" },
              { text: "Deposit 💵", callback_data: "deposit" },
            ],
          ],
        },
      });
    } catch (error) {
      if (
        error.description &&
        error.description.includes("bot was blocked by the user")
      ) {
        console.log(`User ${telegramId} has blocked the bot`);
      } else {
        console.error("Error sending balance message:", error);
      }
    }
  } catch (error) {
    console.error("Error handling balance request:", error);
    try {
      await safeReply(
        ctx,
        "Sorry, there was an error. Please try again later."
      );
    } catch (err) {
      if (
        err.description &&
        err.description.includes("bot was blocked by the user")
      ) {
        console.log(`User ${telegramId} has blocked the bot`);
      } else {
        console.error("Error sending error message:", err);
      }
    }
  }
});

bot.command("deposit", async (ctx) => {
  const telegramId = ctx.from.id;

  // Check if user is blocked
  const { isBlocked } = await checkUserBlocked(ctx, telegramId);
  if (isBlocked) {
    return; // User is blocked, message already sent by checkUserBlocked
  }

  try {
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      await safeReply(
        ctx,
        "Your account is not linked. Please register first.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Register 📝", callback_data: "register" }],
            ],
          },
        }
      );
      return;
    }

    // Get minimum deposit amount to inform user
    const settings = await paymentService.getGameSettings();
    const minDeposit = settings.min_deposit_amount;

    // Start deposit flow
    sessions[telegramId] = { depositState: "method" };

    let depositMessage = "Please select your payment method:";
    if (minDeposit > 0) {
      depositMessage = `Minimum deposit amount is ${minDeposit} ETB.\n\n${depositMessage}`;
    }

    await safeReply(ctx, depositMessage, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Telebirr", callback_data: "deposit_telebirr" },
            { text: "CBE", callback_data: "deposit_cbe" },
          ],
          [{ text: "Cancel", callback_data: "cancel_deposit" }],
        ],
      },
    });
  } catch (error) {
    console.error("Error handling deposit:", error);
    safeReply(ctx, "Sorry, there was an error. Please try again later.");
  }
});

bot.command("withdraw", async (ctx) => {
  const telegramId = ctx.from.id;

  // Check if user is blocked
  const { isBlocked } = await checkUserBlocked(ctx, telegramId);
  if (isBlocked) {
    return; // User is blocked, message already sent by checkUserBlocked
  }

  try {
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      await safeReply(
        ctx,
        "Your account is not linked. Please register first.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Register 📝", callback_data: "register" }],
            ],
          },
        }
      );
      return;
    }
    if (user.balance <= 0) {
      await safeReply(
        ctx,
        `You don't have enough balance to withdraw. Current balance: ${user.balance} ETB`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Play 🎮", callback_data: "play_game" },
                { text: "Deposit 💵", callback_data: "deposit" },
              ],
            ],
          },
        }
      );
      return;
    }

    // Check minimum withdrawal amount

    // Check if user meets the minimum wins requirement
    const winsCheck = await paymentService.checkUserWins(user.id);
    if (!winsCheck.allowed) {
      await safeReply(
        ctx,
        `You need to win at least ${winsCheck.required} games before you can withdraw. You have won ${winsCheck.wins} games so far.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Play 🎮", callback_data: "play_game" }],
            ],
          },
        }
      );
      return;
    }

    sessions[telegramId] = { withdrawState: "method" };
    await safeReply(
      ctx,
      `Your current balance is ${user.balance} ETB.\n\nPlease select your withdrawal method:`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Telebirr", callback_data: "withdraw_telebirr" },
              { text: "CBE", callback_data: "withdraw_cbe" },
            ],
            [{ text: "Cancel", callback_data: "cancel_withdraw" }],
          ],
        },
      }
    );
  } catch (error) {
    console.error("Error handling withdraw:", error);
    safeReply(ctx, "Sorry, there was an error. Please try again later.");
  }
});

bot.command("transactions", async (ctx) => {
  const telegramId = ctx.from.id;

  // Check if user is blocked
  const { isBlocked } = await checkUserBlocked(ctx, telegramId);
  if (isBlocked) {
    return; // User is blocked, message already sent by checkUserBlocked
  }

  try {
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      await safeReply(
        ctx,
        "Your account is not linked. Please register first.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Register 📝", callback_data: "register" }],
            ],
          },
        }
      );
      return;
    }
    const transactions = await paymentService.getUserTransactions(user.id, 5);
    if (transactions.length === 0) {
      await safeReply(ctx, "You don't have any transactions yet.", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Play 🎮", callback_data: "play_game" },
              { text: "Deposit 💵", callback_data: "deposit" },
            ],
          ],
        },
      });
      return;
    }
    let message = "📜 Your Recent Transactions:\n\n";
    transactions.forEach((txn, index) => {
      const txnType =
        txn.transaction_type.charAt(0).toUpperCase() +
        txn.transaction_type.slice(1);
      const status =
        txn.actual_status.charAt(0).toUpperCase() + txn.actual_status.slice(1);
      const date = new Date(txn.created_at).toLocaleDateString();
      const sign = txn.amount > 0 ? "+" : "";
      message += `${index + 1}. ${txnType}: ${sign}${txn.amount} ETB\n`;
      message += `   Status: ${status}\n`;
      message += `   Date: ${date}\n`;
      if (txn.transaction_number) {
        message += `   Reference: ${txn.transaction_number}\n`;
      }
      message += "\n";
    });
    await safeReply(ctx, message, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Play 🎮", callback_data: "play_game" },
            { text: "Deposit 💵", callback_data: "deposit" },
          ],
        ],
      },
    });
  } catch (error) {
    console.error("Error handling transactions request:", error);
    safeReply(ctx, "Sorry, there was an error. Please try again later.");
  }
});

bot.command("referrals", async (ctx) => {
  const telegramId = ctx.from.id;

  // Check if user is blocked
  const { isBlocked } = await checkUserBlocked(ctx, telegramId);
  if (isBlocked) {
    return; // User is blocked, message already sent by checkUserBlocked
  }

  try {
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      await safeReply(
        ctx,
        "Please create an account first by using the /start command.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Register 📝", callback_data: "register" }],
            ],
          },
        }
      );
      return;
    }
    const referralData = await getUserReferralData(user.id);
    if (!referralData) {
      await safeReply(
        ctx,
        "Unable to retrieve referral information. Please try again later."
      );
      return;
    }
    let message = `🔗 <b>Your Referral Link</b>\n${referralData.referralLink}\n\n`;
    message += `🎁 <b>Referral Reward</b>: ${referralData.settings.fixed_reward_amount} ETB for each new user\n\n`;
    message += `👥 <b>Total Referred</b>: ${referralData.totalReferred}\n`;
    message += `💵 <b>Total Earnings</b>: ${referralData.totalEarnings} ETB\n\n`;
    if (referralData.earnings.length > 0) {
      message += `<b>Recent Earnings:</b>\n`;
      const recentEarnings = referralData.earnings.slice(0, 5);
      recentEarnings.forEach((earning) => {
        const date = new Date(earning.created_at).toLocaleDateString();
        message += `- ${earning.amount} ETB from @${earning.referred_username} (${date})\n`;
      });
    } else {
      message += `<b>Share your referral link to earn rewards!</b>\n`;
      message += `When someone joins using your link, you'll earn ${referralData.settings.fixed_reward_amount} ETB immediately.`;
    }
    await safeReply(ctx, message, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📋 Copy Referral Link",
              callback_data: "copy_referral_link",
            },
          ],
        ],
      },
    });
  } catch (error) {
    console.error("Error retrieving referral data:", error);
    safeReply(
      ctx,
      "Sorry, there was an error retrieving your referral information. Please try again later."
    );
  }
});

bot.command("help", async (ctx) => {
  // Check if user is blocked
  const { isBlocked } = await checkUserBlocked(ctx, ctx.from.id);
  if (isBlocked) {
    return; // User is blocked, message already sent by checkUserBlocked
  }

  await safeReply(
    ctx,
    `
🎮 <b>Bingo Game Bot Help</b> 🎲

Available commands:
• /start - Start the bot
• /play - Start playing Bingo
• /winning_patterns - View winning patterns
• /instructions - Game instructions
• /balance - Check your current balance
• /deposit - Add funds to your account
• /withdraw - Withdraw funds from your account
• /transactions - View your recent transactions
• /referrals - Manage your referrals and earn bonuses
• /referral_voucher - Claim a referral voucher
• /contact_support - Get support contact information
• /help - Show this help message

Need further assistance? Contact support at support@Feshtabingo.com
    `,
    { parse_mode: "HTML" }
  );
});

const processDepositTransaction = async (ctx, telegramId) => {
  const sessionData = sessions[telegramId];
  const { depositMethod, depositAmount, depositTransactionNumber } =
    sessionData;

  // Get user from database
  const user = await getUserByTelegramId(telegramId);

  if (!user) {
    await safeReply(
      ctx,
      "Your account is not linked. Please play the game first to create an account."
    );
    delete sessions[telegramId];
    return;
  }

  // Process the deposit
  const result = await paymentService.processDeposit(
    user.id,
    depositMethod,
    depositAmount,
    depositTransactionNumber
  );

  if (result.success) {
    let message = `✅ Your deposit of ${depositAmount} ETB has been processed successfully!\n\nNew balance: ${result.newBalance} ETB`;
    await safeReply(ctx, message);
  } else {
    await safeReply(ctx, `❌ Failed to process deposit: ${result.message}`);
  }

  delete sessions[telegramId];

  // Show the main menu
  await safeReply(ctx, "What would you like to do next?", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🎮 Play Game", callback_data: "play_game" },
          { text: "🎲 Demo Game", callback_data: "demo_game" },
        ],
        [
          { text: "💰 My Balance", callback_data: "check_balance" },
          { text: "💵 Deposit", callback_data: "deposit" },
        ],
        [
          { text: "💸 Withdraw", callback_data: "withdraw" },
          { text: "📜 My Transactions", callback_data: "transactions" },
        ],
        [
          { text: "👥 Referrals", callback_data: "referrals" },
          { text: "📋 Instructions", callback_data: "instructions" },
        ],
        [{ text: "❓ Help", callback_data: "help" }],
      ],
    },
  });
};

// Add command handlers for referral voucher and contact support
bot.command("referral_voucher", async (ctx) => {
  const telegramId = ctx.from.id;

  // Check if user is blocked
  const { isBlocked } = await checkUserBlocked(ctx, telegramId);
  if (isBlocked) {
    return; // User is blocked, message already sent by checkUserBlocked
  }

  // Check if user exists
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    await safeReply(
      ctx,
      "Your account is not linked. Please play the game first to create an account.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Register 📝", callback_data: "register" }],
          ],
        },
      }
    );
    return;
  }

  // Start voucher claim process
  sessions[telegramId] = { voucherState: "awaiting_code" };
  await safeReply(ctx, "Please enter your voucher code to claim:");
});

// Function to get active contact information from database
const getContactInformation = async () => {
  try {
    const [contacts] = await db.execute(
      "SELECT contact_type, contact_value, description FROM contact_information WHERE is_active = 1 ORDER BY contact_type"
    );
    return contacts;
  } catch (error) {
    console.error("Error fetching contact information:", error);
    return [];
  }
};

// Helper function to get appropriate icon for contact type
function getContactIcon(contactType) {
  switch (contactType.toLowerCase()) {
    case "telegram":
      return "📱";
    case "phone":
      return "☎️";
    case "email":
      return "📧";
    case "whatsapp":
      return "💬";
    case "website":
      return "🌐";
    default:
      return "🔹";
  }
}

// Helper function to capitalize first letter
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Add back the contact_support command handler
bot.command("contact_support", async (ctx) => {
  // Check if user is blocked
  const { isBlocked } = await checkUserBlocked(ctx, ctx.from.id);
  if (isBlocked) {
    return; // User is blocked, message already sent by checkUserBlocked
  }

  try {
    // Get contact information from database
    const contacts = await getContactInformation();

    let supportMessage = `
📞 <b>Contact Support</b>

Need help? Contact our support team:
`;

    if (contacts && contacts.length > 0) {
      // Add each contact to the message
      contacts.forEach((contact) => {
        const icon = getContactIcon(contact.contact_type);
        supportMessage += `\n${icon} ${
          contact.description || capitalizeFirstLetter(contact.contact_type)
        }: ${contact.contact_value}`;
      });
    } else {
      // Fallback to default if no contacts found
      supportMessage += `
🔹 Telegram: @feshtabingosupport
🔹 Phone: 0900000000
`;
    }

    supportMessage += `\nWe're here to help you with any questions or issues!`;

    await safeReply(ctx, supportMessage, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Error retrieving contact information:", error);
    // Fallback to default message if there's an error
    await safeReply(
      ctx,
      `
📞 <b>Contact Support</b>

Need help? Contact our support team:

🔹 Telegram: @feshtabingosupport
🔹 Phone: 0900000000

We're here to help you with any questions or issues!
    `,
      { parse_mode: "HTML" }
    );
  }
});

// Handle regular messages for deposit/withdraw flows and now voucher code
bot.on("text", async (ctx) => {
  // Only filter out commands, but allow keyboard buttons to be processed by their respective handlers
  if (ctx.message.text.startsWith("/")) {
    return;
  }

  const messageText = ctx.message.text;
  const telegramId = ctx.from.id;

  // Check if user is blocked
  const { isBlocked } = await checkUserBlocked(ctx, telegramId);
  if (isBlocked) {
    return; // User is blocked, message already sent by checkUserBlocked
  }

  const sessionData = sessions[telegramId] || {};

  // Handle voucher claim flow
  if (sessionData.voucherState === "awaiting_code") {
    const voucherCode = messageText.trim();

    if (!voucherCode) {
      await safeReply(ctx, "Please enter a valid voucher code:");
      return;
    }

    // Get user from database
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      await safeReply(
        ctx,
        "Your account is not linked. Please play the game first to create an account."
      );
      delete sessions[telegramId];
      return;
    }

    try {
      // Send request to claim voucher
      const response = await axios.post(
        "https://api.chapabingo.com/api/referrals/claim-voucher",
        {
          userId: user.id,
          voucherCode: voucherCode,
        }
      );

      if (response.data) {
        await safeReply(
          ctx,
          `✅ Voucher claimed successfully! You received ${response.data.voucherAmount} ETB.\n\nNew balance: ${response.data.newBalance} ETB`
        );
      }

      delete sessions[telegramId];

      // Show the main menu again
      await safeReply(ctx, "What would you like to do next?", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🎮 Play Game", callback_data: "play_game" },
              {
                text: "🏆 Winning Patterns",
                callback_data: "winning_patterns",
              },
            ],
            [
              { text: "📝 Game Instructions", callback_data: "instructions" },
              { text: "💰 My Balance", callback_data: "check_balance" },
            ],
            [
              { text: "💵 Deposit", callback_data: "deposit" },
              { text: "💸 Withdraw", callback_data: "withdraw" },
            ],
            [
              { text: "📜 My Transactions", callback_data: "transactions" },
              { text: "👥 Referrals", callback_data: "referrals" },
            ],
            [
              {
                text: "🎟️ Referral Voucher",
                callback_data: "referral_voucher",
              },
              { text: "📞 Contact Support", callback_data: "contact_support" },
            ],
            [{ text: "❓ Help", callback_data: "help" }],
          ],
        },
      });
    } catch (error) {
      console.error("Error claiming voucher:", error);
      if (error.response && error.response.status === 404) {
        await safeReply(
          ctx,
          "❌ Voucher not found or has expired. Please check the code and try again."
        );
      } else {
        await safeReply(
          ctx,
          "❌ Failed to claim voucher. Please try again later."
        );
      }
      delete sessions[telegramId];
    }
  }
  // Handle deposit flow
  else if (sessionData.depositState === "amount" && sessionData.depositMethod) {
    // Validate amount
    const amount = parseFloat(messageText);

    if (isNaN(amount) || amount <= 0) {
      await safeReply(ctx, "Please enter a valid amount (greater than 0):");
      return;
    }

    // Check minimum deposit amount
    const depositCheck = await paymentService.checkMinimumDeposit(amount);
    if (!depositCheck.allowed) {
      await safeReply(
        ctx,
        `Minimum deposit amount is ${depositCheck.required} ETB. Please enter a higher amount:`
      );
      return;
    }

    // Update session with amount
    sessions[telegramId] = {
      ...sessionData,
      depositAmount: amount,
      depositState: "instructions",
    };

    // Get payment details
    const paymentDetails = await paymentService.getPaymentSettings(
      sessionData.depositMethod
    );

    if (!paymentDetails) {
      await safeReply(
        ctx,
        "Sorry, this payment method is currently unavailable. Please try another method."
      );
      delete sessions[telegramId];
      return;
    }

    let instructionsMessage;

    if (sessionData.depositMethod === "telebirr") {
      const escapedPhone = escapeMarkdownV2(paymentDetails.account_number);
      const escapedAmount = escapeMarkdownV2(`${amount} ETB`);

      instructionsMessage =
        `*Please follow these steps to deposit via Telebirr:*\n\n` +
        `እባክዎ ከታች ባለው የቴሌ ብር/አካውንት ቁጥር ገቢ አድርገው የሚደርስዎን መልእክት \\(text message\\) ኮፒ አድርገው እዚህ ቦት ላይ ፔስት ያድርጉ። እናመሰግናለን\n\n` +
        `1\\. Open your Telebirr app\n` +
        `2\\. Select "Pay" or "Transfer"\n` +
        `3\\. Enter the phone number: \`${escapedPhone}\`\n` +
        `4\\. Enter amount: \`${escapedAmount}\`\n` +
        `5\\. Complete the payment\n` +
        `6\\. After payment, you'll receive an SMS like: "You have transferred ETB X to NAME\\. Your transaction number is CF92RK\\.\\.\\."\n` +
        `7\\. Copy the transaction number or paste the entire SMS here`;
    } else {
      // CBE
      const escapedAmount = escapeMarkdownV2(`${amount} ETB`);
      const escapedAccountNumber = escapeMarkdownV2(
        paymentDetails.account_number
      );
      const escapedAccountName = escapeMarkdownV2(paymentDetails.account_name);

      instructionsMessage =
  `*Please follow these steps to deposit via CBE:*\n\n` +
  `እባክዎ ከታች ባለው የቴሌ ብር/አካውንት ቁጥር ገቢ አድርገው የሚደርስዎን መልእክት \\(text message\\) ኮፒ አድርገው እዚህ ቦት ላይ ፔስት ያድርጉ። እናመሰግናለን\n\n` +
  `1\\. Transfer \`${escapedAmount}\` to the following account:\n` +
  `   \\- Account Number: \`${escapedAccountNumber}\`\n` +
  `   \\- Account Name: \`${escapedAccountName}\`\n` +
  `2\\. After transfer, you'll receive an SMS with a link like: "https://apps\\.cbe\\.com\\.et:100/\\?id\\=FT2516052C43\\.\\.\\."\n` +
  `3\\. Copy the transaction ID \\(FT followed by 10 characters\\) or paste the entire SMS here`;

    }

    await safeReply(ctx, instructionsMessage, { parse_mode: "MarkdownV2" });
  } else if (
    sessionData.depositState === "instructions" &&
    sessionData.depositAmount
  ) {
    // This is the transaction number input
    const originalInput = messageText.trim();

    // Extract transaction number from full message if needed
    let transactionNumber = originalInput;

    // For CBE: Extract FT followed by 10 characters from anywhere in the message
    // This works for both the full SMS and direct entry of transaction ID
    const cbeRegex = /FT[A-Z0-9]{10}/;
    const cbeMatch = originalInput.match(cbeRegex);

    // For Telebirr: Extract transaction number from SMS or direct entry
    // Pattern 1: SMS format "Your transaction number is CF92RKZ71M"
    const telebirrRegex1 = /transaction number is ([A-Z0-9]{10})/i;
    const telebirrMatch1 = originalInput.match(telebirrRegex1);

    // Pattern 2: Standard format mentioned in message with whitespace
    const telebirrRegex2 = /transaction number\s+([A-Z0-9]{10})/i;
    const telebirrMatch2 = originalInput.match(telebirrRegex2);

    // Pattern 3: Direct entry of a 10-character alphanumeric code
    const directCodeRegex = /^[A-Z0-9]{10}$/;
    const directMatch = originalInput.match(directCodeRegex);

    if (cbeMatch) {
      transactionNumber = cbeMatch[0];
    } else if (telebirrMatch1) {
      transactionNumber = telebirrMatch1[1];
    } else if (telebirrMatch2) {
      transactionNumber = telebirrMatch2[1];
    } else if (directMatch && originalInput.length === 10) {
      // If it's exactly 10 alphanumeric characters, use as is
      transactionNumber = originalInput;
    }

    // Validate the extracted transaction number
    if (!transactionNumber || transactionNumber.trim().length < 3) {
      await safeReply(ctx, "Please enter a valid transaction number:");
      return;
    }

    // Update session with transaction number
    sessions[telegramId] = {
      ...sessionData,
      depositTransactionNumber: transactionNumber.trim(),
      depositState: "processing",
    };

    // Let user know what transaction number was extracted if it was different from their input
    if (transactionNumber !== originalInput) {
      await safeReply(
        ctx,
        `Extracted transaction number: ${transactionNumber}`
      );
    }

    // Process the deposit
    await processDepositTransaction(ctx, telegramId);
  }
  // Handle transfer flow
  else if (sessionData.transferState === "phone") {
    // Validate phone number format
    let phoneNumber = messageText.trim();
console.log(phoneNumber)
    // Convert 09 format to +251 format
    if (phoneNumber.startsWith("09")) {
      phoneNumber = "251" + phoneNumber.substring(1);
    } else if (phoneNumber.startsWith("9")) {
      phoneNumber = "+251" + phoneNumber;
    } else if (
      phoneNumber.startsWith("+251") &&
      !phoneNumber.startsWith("251")
    ) {
      phoneNumber =  phoneNumber;
    }
console.log(phoneNumber)
    // Find user with this phone number
    const targetUser = await getUserByPhoneNumber(phoneNumber);
console.log(targetUser)
    if (!targetUser) {
      await safeReply(
        ctx,
        "User not found with this phone number. Please check the number and try again:"
      );
      return;
    }

    // if (targetUser.id === user.id) {
    //   await safeReply(
    //     ctx,
    //     "You cannot transfer to yourself. Please enter a different phone number:"
    //   );
    //   return;
    // }

    // Update session with target user info
    sessions[telegramId] = {
      ...sessionData,
      transferTargetUser: targetUser,
      transferState: "amount",
    };

    await safeReply(
      ctx,
      `Found user: ${targetUser.username}\n\nPlease enter the amount you want to transfer:`
    );
  } else if (
    sessionData.transferState === "amount" &&
    sessionData.transferTargetUser
  ) {
    // Validate amount
    const amount = parseFloat(messageText);

    if (isNaN(amount) || amount <= 0) {
      await safeReply(ctx, "Please enter a valid amount (greater than 0):");
      return;
    }

    // Check if user has enough balance
    const user = await getUserByTelegramId(telegramId);
    if (amount > user.balance) {
      await safeReply(
        ctx,
        `Insufficient balance. Your current balance is ${user.balance} ETB. Please enter a smaller amount:`
      );
      return;
    }

    // Update session with amount
    sessions[telegramId] = {
      ...sessionData,
      transferAmount: amount,
      transferState: "confirm",
    };

    const confirmationMessage = `Please confirm your transfer:\n\nAmount: ${amount} ETB\nTo: ${sessionData.transferTargetUser.username}\n\nIs this correct?`;

    await safeReply(ctx, confirmationMessage, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Confirm Transfer", callback_data: "confirm_transfer" },
            { text: "❌ Cancel", callback_data: "cancel_transfer" },
          ],
        ],
      },
    });
  } else if (
    sessionData.transferState === "confirm" &&
    sessionData.transferAmount
  ) {
    // This should be handled by the callback query, but just in case
    await safeReply(
      ctx,
      "Please use the buttons to confirm or cancel the transfer."
    );
  }
  // Handle withdrawal flow
  else if (
    sessionData.withdrawState === "amount" &&
    sessionData.withdrawMethod
  ) {
    // Validate amount
    const amount = parseFloat(messageText);

    if (isNaN(amount) || amount <= 0) {
      await safeReply(ctx, "Please enter a valid amount (greater than 0):");
      return;
    }

    // Check minimum withdrawal amount
    const withdrawalCheck = await paymentService.checkMinimumWithdrawal(amount);
    if (!withdrawalCheck.allowed) {
      await safeReply(
        ctx,
        `Minimum withdrawal amount is ${withdrawalCheck.required} ETB. Please enter a higher amount:`
      );
      return;
    }

    // Update session with amount
    sessions[telegramId] = {
      ...sessionData,
      withdrawAmount: amount,
      withdrawState: "account",
    };

    let promptMessage;

    if (sessionData.withdrawMethod === "telebirr") {
      promptMessage =
        "Please enter your Telebirr phone number (e.g., 251912345678):";
    } else {
      // CBE
      promptMessage = "Please enter your CBE account number:";
    }

    await safeReply(ctx, promptMessage);
  } else if (
    sessionData.withdrawState === "account" &&
    sessionData.withdrawAmount
  ) {
    // Validate account number
    if (!messageText || messageText.trim().length < 5) {
      let promptMessage;

      if (sessionData.withdrawMethod === "telebirr") {
        promptMessage = "Please enter a valid Telebirr phone number:";
      } else {
        // CBE
        promptMessage = "Please enter a valid CBE account number:";
      }

      await safeReply(ctx, promptMessage);
      return;
    }

    // Update session with account number
    sessions[telegramId] = {
      ...sessionData,
      withdrawAccount: messageText.trim(),
      withdrawState: "name",
    };

    await safeReply(
      ctx,
      "Please enter the account holder name (your full name):"
    );
  } else if (
    sessionData.withdrawState === "name" &&
    sessionData.withdrawAccount
  ) {
    // Validate name
    if (!messageText || messageText.trim().length < 3) {
      await safeReply(ctx, "Please enter a valid name:");
      return;
    }

    // Update session with name
    sessions[telegramId] = {
      ...sessionData,
      withdrawName: messageText.trim(),
      withdrawState: "confirm",
    };

    // Build confirmation message
    const confirmationMessage = `Please confirm your withdrawal request:\n\nAmount: ${
      sessionData.withdrawAmount
    } ETB\nMethod: ${
      sessionData.withdrawMethod === "telebirr" ? "Telebirr" : "CBE"
    }\nAccount: ${
      sessionData.withdrawAccount
    }\nName: ${messageText.trim()}\n\nIs this information correct?`;

    await safeReply(ctx, confirmationMessage, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Confirm", callback_data: "confirm_withdraw" },
            { text: "❌ Cancel", callback_data: "cancel_withdraw" },
          ],
        ],
      },
    });
  }
  // Default response for other messages
  else {
    // Default response for non-command messages
    await safeReply(ctx, "Welcome to Feshta Bingo! Choose an option below.", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🎮 Play Game", callback_data: "play_game" },
            { text: "🏆 Winning Patterns", callback_data: "winning_patterns" },
          ],
          [
            { text: "📝 Game Instructions", callback_data: "instructions" },
            { text: "💰 My Balance", callback_data: "check_balance" },
          ],
          [
            { text: "💵 Deposit", callback_data: "deposit" },
            { text: "💸 Withdraw", callback_data: "withdraw" },
          ],
          [
            { text: "📜 My Transactions", callback_data: "transactions" },
            { text: "👥 Referrals", callback_data: "referrals" },
          ],
          [
            { text: "🎟️ Referral Voucher", callback_data: "referral_voucher" },
            { text: "📞 Contact Support", callback_data: "contact_support" },
          ],
          [{ text: "❓ Help", callback_data: "help" }],
        ],
      },
    });
  }
});

// Handle contact sharing for new user registration
bot.on("contact", async (ctx) => {
  try {
    const contact = ctx.message.contact;
    const telegramId = ctx.from.id;

    // Make sure the contact belongs to the user who sent it
    if (contact.user_id !== telegramId) {
      try {
        await safeReply(ctx, "Please share your own contact information.");
      } catch (error) {
        if (
          error.description &&
          error.description.includes("bot was blocked by the user")
        ) {
          console.log(`User ${telegramId} has blocked the bot`);
        } else {
          console.error("Error sending contact validation message:", error);
        }
      }
      return;
    }

    const phoneNumber = contact.phone_number;
    const firstName = contact.first_name || ctx.from.first_name;
    const lastName = contact.last_name || ctx.from.last_name || "";
    const username = ctx.from.username || `user${telegramId}`;

    // Check if user with this phone number already exists
    const existingUser = await getUserByPhoneNumber(phoneNumber);

    if (existingUser) {
      // User exists but not linked to this Telegram ID
      if (existingUser.telegram_id !== telegramId) {
        // Update the Telegram ID for the existing user
        try {
          await db.execute("UPDATE users SET telegram_id = ? WHERE id = ?", [
            telegramId,
            existingUser.id,
          ]);

          try {
            await safeReply(
              ctx,
              `Welcome back ${firstName}! Your account has been linked successfully.`,
              {
                reply_markup: {
                  remove_keyboard: true,
                },
              }
            );
          } catch (error) {
            if (
              error.description &&
              error.description.includes("bot was blocked by the user")
            ) {
              console.log(`User ${telegramId} has blocked the bot`);
            } else {
              console.error("Error sending welcome back message:", error);
            }
          }
        } catch (error) {
          console.error("Error updating user telegram_id:", error);
          try {
            await safeReply(
              ctx,
              "Sorry, there was an error linking your account. Please try again later."
            );
          } catch (err) {
            if (
              err.description &&
              err.description.includes("bot was blocked by the user")
            ) {
              console.log(`User ${telegramId} has blocked the bot`);
            } else {
              console.error("Error sending error message:", err);
            }
          }
        }
      } else {
        // User already linked
        try {
          await safeReply(
            ctx,
            `Welcome back ${firstName}! Your account is already linked.`,
            {
              reply_markup: {
                remove_keyboard: true,
              },
            }
          );
        } catch (error) {
          if (
            error.description &&
            error.description.includes("bot was blocked by the user")
          ) {
            console.log(`User ${telegramId} has blocked the bot`);
          } else {
            console.error("Error sending already linked message:", error);
          }
        }
      }
    } else {
      // Create new user
      try {
        // Get referral code from session if exists
        const sessionData = sessions[telegramId] || {};
        let referrerId = null;

        if (sessionData.referralCode) {
          console.log(
            `Looking up referrer with code: ${sessionData.referralCode}`
          );

          // Find user with this referral code
          const [referrer] = await db.execute(
            "SELECT id FROM users WHERE referral_code = ?",
            [sessionData.referralCode]
          );

          console.log("Referrer lookup result:", referrer);

          if (referrer.length > 0) {
            referrerId = referrer[0].id;
            console.log(`Found referrer with ID: ${referrerId}`);
          } else {
            console.log(
              `No referrer found with code: ${sessionData.referralCode}`
            );
          }
        }

        // Generate a unique referral code for this user
        const referralCode = generateReferralCode();

        // Insert new user
        const [result] = await db.execute(
          "INSERT INTO users (username, email, password, phone_number, telegram_id, referral_code, referred_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            username,
            username,
            username,
            phoneNumber,
            telegramId,
            referralCode,
            referrerId,
          ]
        );

        if (result.insertId) {
          // Process welcome bonus for new user
          try {
            console.log(
              "Processing welcome bonus for new user:",
              result.insertId
            );

            const [gameSettings] = await db.execute(
              "SELECT welcome_bonus_amount, welcome_bonus_max_users, welcome_bonus_enabled, welcome_bonus_users_given FROM game_settings WHERE id = 1"
            );

            console.log("Game settings for welcome bonus:", gameSettings);

            if (
              gameSettings.length > 0 &&
              gameSettings[0].welcome_bonus_enabled
            ) {
              const settings = gameSettings[0];
              const maxUsers = settings.welcome_bonus_max_users;
              const currentGiven = settings.welcome_bonus_users_given;

              console.log(
                "Welcome bonus enabled. Max users:",
                maxUsers,
                "Current given:",
                currentGiven
              );

              // Check if we haven't reached the maximum users limit
              if (maxUsers === 0 || currentGiven < maxUsers) {
                const bonusAmount =
                  parseFloat(settings.welcome_bonus_amount) || 0;

                console.log("Bonus amount:", bonusAmount);

                if (bonusAmount > 0) {
                  // Add bonus to user balance
                  await db.execute(
                    "UPDATE users SET balance = balance + ? WHERE id = ?",
                    [bonusAmount, result.insertId]
                  );

                  // Add transaction record
                  await db.execute(
                    "INSERT INTO transactions (user_id, transaction_type, amount, status, reference_id) VALUES (?, 'bonus', ?, 'completed', ?)",
                    [
                      result.insertId,
                      bonusAmount,
                      `WELCOME-BONUS-${result.insertId}`,
                    ]
                  );

                  // Update the count of users who received bonus
                  await db.execute(
                    "UPDATE game_settings SET welcome_bonus_users_given = welcome_bonus_users_given + 1 WHERE id = 1"
                  );

                  console.log(
                    `Welcome bonus of ${bonusAmount} ETB given to user ${result.insertId}`
                  );

                  // Send welcome bonus notification to user
                  try {
                    await safeSendMessage(
                      telegramId,
                      `🎉 Welcome to Feshta Bingo! You've received a welcome bonus of ${bonusAmount} ETB!`
                    );
                  } catch (error) {
                    console.error(
                      "Error sending welcome bonus notification:",
                      error
                    );
                  }
                } else {
                  console.log(
                    "Bonus amount is 0 or negative, skipping welcome bonus"
                  );
                }
              } else {
                console.log("Maximum users limit reached for welcome bonus");
              }
            } else {
              console.log(
                "Welcome bonus is disabled or no game settings found"
              );
            }
          } catch (error) {
            console.error("Error processing welcome bonus:", error);
          }

          // Process referral reward if user was referred
          if (referrerId) {
            const referralResult = await processReferralReward(result.insertId);

            // If a referral reward was awarded, notify the referrer via Telegram
            if (referralResult.success) {
              try {
                // Get referrer telegram ID
                const [referrerData] = await db.execute(
                  "SELECT telegram_id FROM users WHERE id = ?",
                  [referralResult.referrerId]
                );

                if (referrerData.length > 0 && referrerData[0].telegram_id) {
                  // Send notification to referrer
                  await safeSendMessage(
                    referrerData[0].telegram_id,
                    `🎉 Congratulations! You've earned a referral reward of ${referralResult.rewardAmount} ETB for inviting a new user.`
                  );
                }
              } catch (error) {
                console.error("Error sending referral notification:", error);
              }
            }
          }

          try {
            await safeReply(
              ctx,
              `Thank you ${firstName}! Your account has been created successfully.`,
              {
                reply_markup: {
                  remove_keyboard: true,
                },
              }
            );

            // Send welcome message with main menu
            await safeReply(
              ctx,
              "Welcome to Feshta Bingo! Choose an option below.",
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: "🎮 Play Game", callback_data: "play_game" },
                      {
                        text: "🏆 Winning Patterns",
                        callback_data: "winning_patterns",
                      },
                    ],
                    [
                      {
                        text: "📝 Game Instructions",
                        callback_data: "instructions",
                      },
                      { text: "💰 My Balance", callback_data: "check_balance" },
                    ],
                    [
                      { text: "💵 Deposit", callback_data: "deposit" },
                      { text: "💸 Withdraw", callback_data: "withdraw" },
                    ],
                    [
                      {
                        text: "📜 My Transactions",
                        callback_data: "transactions",
                      },
                      { text: "👥 Referrals", callback_data: "referrals" },
                    ],
                    [
                      {
                        text: "🎟️ Referral Voucher",
                        callback_data: "referral_voucher",
                      },
                      {
                        text: "📞 Contact Support",
                        callback_data: "contact_support",
                      },
                    ],
                    [{ text: "❓ Help", callback_data: "help" }],
                  ],
                },
              }
            );
          } catch (error) {
            if (
              error.description &&
              error.description.includes("bot was blocked by the user")
            ) {
              console.log(`User ${telegramId} has blocked the bot`);
            } else {
              console.error(
                "Error sending registration success message:",
                error
              );
            }
          }
        }
      } catch (error) {
        console.error("Error creating new user:", error);
        try {
          await safeReply(
            ctx,
            "Sorry, there was an error creating your account. Please try again later."
          );
        } catch (err) {
          if (
            err.description &&
            err.description.includes("bot was blocked by the user")
          ) {
            console.log(`User ${telegramId} has blocked the bot`);
          } else {
            console.error("Error sending error message:", err);
          }
        }
      }
    }

    // Clean up session data
    delete sessions[telegramId];
  } catch (error) {
    console.error("Error handling contact:", error);
    try {
      await safeReply(
        ctx,
        "Sorry, there was an error. Please try again later."
      );
    } catch (err) {
      console.error("Error sending error message:", err);
    }
  }
});

// API endpoint for sending withdrawal rejection notifications
app.post("/api/telegram/send-withdrawal-rejection", async (req, res) => {
  try {
    const { userId, rejectionReason } = req.body;
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "User ID is required" });
    }

    await sendWithdrawalRejectionNotification(userId, rejectionReason);

    return res.status(200).json({
      success: true,
      message: "Rejection notification sent successfully",
    });
  } catch (error) {
    console.error("Error in send-withdrawal-rejection endpoint:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send rejection notification",
    });
  }
});

// API endpoint for admin to send messages to users via the bot
app.post("/api/telegram/send-message", async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) {
      return res
        .status(400)
        .json({ success: false, message: "User ID and message are required" });
    }

    // Use the safeSendMessage function directly
    const result = await safeSendMessage(userId, message);

    if (result) {
      return res
        .status(200)
        .json({ success: true, message: "Message sent successfully" });
    } else {
      return res.status(200).json({
        success: false,
        message: "User has blocked the bot or message could not be delivered",
      });
    }
  } catch (error) {
    console.error("Error in send-message endpoint:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to send message" });
  }
});

// Function to send withdrawal rejection notification
const sendWithdrawalRejectionNotification = async (userId, rejectionReason) => {
  try {
    // Get user's telegram ID
    const [users] = await db.execute(
      "SELECT telegram_id FROM users WHERE id = ?",
      [userId]
    );

    if (users.length > 0 && users[0].telegram_id) {
      const message = `❌ Your withdrawal request has been rejected.\n\nReason: ${
        rejectionReason || "No reason provided"
      }\n\nPlease contact support if you have any questions.`;
      await safeSendMessage(users[0].telegram_id, message);
    }
  } catch (error) {
    console.error("Error sending withdrawal rejection notification:", error);
  }
};

// API endpoint for admin to broadcast messages to all users
app.post("/api/telegram/broadcast", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res
        .status(400)
        .json({ success: false, message: "Message is required" });
    }
    const [users] = await db.execute(
      "SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL"
    );
    if (!users || users.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No users found with Telegram IDs" });
    }
    let successful = 0;
    let failed = 0;
    for (const user of users) {
      // Use safeSendMessage directly without try/catch
      const result = await safeSendMessage(user.telegram_id, message);
      if (result) {
        successful++;
      } else {
        failed++;
      }
    }
    return res.status(200).json({
      success: true,
      message: `Broadcast complete. Successfully sent: ${successful}, Failed: ${failed}`,
    });
  } catch (error) {
    console.error("Error broadcasting message:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to broadcast message" });
  }
});

// Start the Express server for bot API
const PORT = process.env.BOT_PORT || 5034;
app.listen(PORT, () => {
  console.log(`Bot server running on port ${PORT}`);
});

// Start the bot
bot
  .launch()
  .then(() => {
    console.log("Telegram bot started successfully");
  })
  .catch((err) => {
    console.error("Error starting Telegram bot:", err);
  });

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

// Enhanced global error handlers to prevent the bot from stopping
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise);
  console.error("Reason:", reason);

  // If this is a Telegraf error related to a blocked user, just log it
  if (
    reason &&
    reason.description &&
    reason.description.includes("bot was blocked by the user")
  ) {
    console.log("A user has blocked the bot - this is normal behavior");
  } else {
    // For other errors, log more details but don't crash
    console.error(
      "Stack trace:",
      reason && reason.stack ? reason.stack : "No stack trace available"
    );
  }

  // Optionally: send alert to admin, log to file, etc.
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
  console.error("Stack trace:", err.stack || "No stack trace available");

  // If this is a Telegraf error related to a blocked user, just log it
  if (
    err &&
    err.description &&
    err.description.includes("bot was blocked by the user")
  ) {
    console.log("A user has blocked the bot - this is normal behavior");
  } else {
    // For other errors, log more details but don't crash
    console.error("Error details:", err);
  }

  // Optionally: send alert to admin, log to file, etc.

  // Do NOT call process.exit() here as it would stop the bot
});

// Add an error handler specifically for the bot
bot.catch((err, ctx) => {
  console.error(`Error in bot update ${ctx.updateType}:`, err);

  // If user blocked the bot, just log it
  if (
    err.description &&
    err.description.includes("bot was blocked by the user")
  ) {
    console.log(
      `User ${ctx.from ? ctx.from.id : "unknown"} has blocked the bot`
    );
    return;
  }

  // For other errors, try to notify the user if possible
  try {
    if (ctx && ctx.from) {
      safeReply(ctx, "Sorry, something went wrong. Please try again later.");
    }
  } catch (replyError) {
    console.error("Error sending error message:", replyError);
  }
});
