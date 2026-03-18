require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
const path = require("path");

// Import routes
const telegramRoutes = require("./routes/telegramRoutes");
const paymentRoutes = require("./routes/paymentRoutes");

// Payment service for handling transactions
const paymentService = require("./services/paymentService");

// Use the provided token from environment or fall back to the hardcoded value (for local dev)
const BOT_TOKEN = process.env.BOT_TOKEN || "8427577528:AAF3z-O84R-oRALh5hiEJnUJWu5x5M-EnP0";

// Initialize Telegram bot with session
const bot = new Telegraf(BOT_TOKEN);
const app = express();

// Serve a simple admin dashboard (static files)
app.use("/admin", express.static(path.join(__dirname, "admin")));

// Session data for users (store in memory)
const sessions = {};

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
      "SELECT id, username, phone_number, balance, telegram_id FROM users WHERE telegram_id = ?",
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
      "SELECT id, username, phone_number, balance, telegram_id FROM users WHERE phone_number = ?",
      [phoneNumber]
    );

    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error("Error fetching user by phone number:", error);
    return null;
  }
};

// Generate a random referral code for a user
const generateReferralCode = () => {
  return "REF" + Math.random().toString(36).substring(2, 10).toUpperCase();
};

// Process referral bonus after deposit
const processReferralBonus = async (userId) => {
  try {
    // First check if this is the user's first deposit
    const [transactions] = await db.execute(
      "SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND transaction_type = 'deposit' AND status = 'completed'",
      [userId]
    );

    if (transactions[0].count > 1) {
      // Not first deposit, no bonus
      return { success: false, message: "Not first deposit" };
    }

    // Get the user's referrer
    const [userInfo] = await db.execute(
      "SELECT referred_by FROM users WHERE id = ?",
      [userId]
    );

    if (!userInfo[0] || !userInfo[0].referred_by) {
      // No referrer, no bonus
      return { success: false, message: "No referrer" };
    }

    const referrerId = userInfo[0].referred_by;

    // Get referral settings
    const [settings] = await db.execute(
      "SELECT bonus_percentage, min_deposit_amount FROM referral_settings WHERE id = 1"
    );

    if (!settings || settings.length === 0) {
      return { success: false, message: "No referral settings" };
    }

    const bonusPercentage = settings[0].bonus_percentage;
    const minDepositAmount = settings[0].min_deposit_amount;

    // Get the deposit amount
    const [depositInfo] = await db.execute(
      "SELECT SUM(amount) as total FROM transactions WHERE user_id = ? AND transaction_type = 'deposit' AND status = 'completed'",
      [userId]
    );

    const depositAmount = depositInfo[0].total || 0;

    if (depositAmount < minDepositAmount) {
      return { success: false, message: "Deposit below minimum" };
    }

    // Calculate bonus amount
    const bonusAmount = (depositAmount * bonusPercentage) / 100;

    // Begin transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Create referral earning record
      await connection.execute(
        "INSERT INTO referral_earnings (referrer_id, referred_id, amount, status, completed_at) VALUES (?, ?, ?, 'completed', NOW())",
        [referrerId, userId, bonusAmount]
      );

      // Update referrer's balance
      await connection.execute(
        "UPDATE users SET balance = balance + ? WHERE id = ?",
        [bonusAmount, referrerId]
      );

      // Add transaction record
      await connection.execute(
        "INSERT INTO transactions (user_id, transaction_type, amount, status, reference_id) VALUES (?, 'commission', ?, 'completed', ?)",
        [referrerId, bonusAmount, `REFERRAL-${userId}`]
      );

      await connection.commit();

      return {
        success: true,
        message: "Referral bonus processed",
        bonusAmount,
        referrerId,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error processing referral bonus:", error);
    return { success: false, message: "Server error" };
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
      "SELECT bonus_percentage, min_deposit_amount FROM referral_settings WHERE id = 1"
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
        bonus_percentage: 10,
        min_deposit_amount: 100,
      },
    };
  } catch (error) {
    console.error("Error getting referral info:", error);
    return null;
  }
};

// Updated welcome message and start command handler
bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const firstName = ctx.from.first_name;

  // Check if this is a referral link click
  const startPayload = ctx.startPayload || "";
  let referralCode = null;

  if (startPayload.startsWith("ref_")) {
    referralCode = startPayload.substring(4);
  }

  try {
    // Check if user already exists
    const user = await getUserByTelegramId(telegramId);

    if (user) {
      // User already exists, send normal welcome message
      await ctx.reply(`Welcome back ${firstName}! Ready to play Bingo?`, {
        reply_markup: {
          keyboard: [
            ["🎮 Play Game", "💰 My Balance"],
            ["💵 Deposit", "💸 Withdraw"],
            ["📜 My Transactions", "👥 Referrals"],
            ["❓ Help"],
          ],
          resize_keyboard: true,
        },
      });
    } else {
      // Store referral code in session if available
      if (referralCode) {
        sessions[telegramId] = {
          ...(sessions[telegramId] || {}),
          referralCode,
        };
      }

      // New user, request phone number
      await ctx.reply(
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
    await ctx.reply("Sorry, something went wrong. Please try again later.");
  }
});

// New handler for contact/phone number sharing
bot.on("contact", async (ctx) => {
  const telegramId = ctx.from.id;
  const contact = ctx.message.contact;
  const sessionData = sessions[telegramId] || {};
  const referralCode = sessionData.referralCode;

  // Verify that the contact belongs to the user
  if (contact.user_id !== telegramId) {
    await ctx.reply("Please share your own contact information.", {
      reply_markup: {
        keyboard: [
          [{ text: "📱 Share My Phone Number", request_contact: true }],
        ],
        resize_keyboard: true,
      },
    });
    return;
  }

  const phoneNumber = contact.phone_number;

  try {
    // Check if user with this phone number already exists
    const connection = await db.getConnection();

    try {
      // Check if phone number already exists but with different Telegram ID
      const [existingUsers] = await connection.execute(
        "SELECT * FROM users WHERE phone_number = ?",
        [phoneNumber]
      );

      if (existingUsers.length > 0) {
        // Phone number exists, update the Telegram ID
        const existingUser = existingUsers[0];

        // Update the user's Telegram ID
        await connection.execute(
          "UPDATE users SET telegram_id = ? WHERE id = ?",
          [telegramId, existingUser.id]
        );

        await connection.commit();

        await ctx.reply(
          `Welcome back! Your account has been linked to your Telegram.`,
          {
            reply_markup: {
              keyboard: [
                ["🎮 Play Game", "💰 My Balance"],
                ["💵 Deposit", "💸 Withdraw"],
                ["📜 My Transactions", "👥 Referrals"],
                ["❓ Help"],
              ],
              resize_keyboard: true,
            },
          }
        );
      } else {
        // Check if referral code exists
        let referrerId = null;

        if (referralCode) {
          const [referrerData] = await connection.execute(
            "SELECT id FROM users WHERE referral_code = ?",
            [referralCode]
          );

          if (referrerData.length > 0) {
            referrerId = referrerData[0].id;
          }
        }

        // Create new user with phone number and Telegram ID
        const username = `user_${Date.now().toString().slice(-6)}`;
        const defaultBalance = 0;
        const newReferralCode = generateReferralCode();

        // Insert new user with referral data
        await connection.execute(
          "INSERT INTO users (username, phone_number, telegram_id, balance, referral_code, referred_by) VALUES (?, ?, ?, ?, ?, ?)",
          [
            username,
            phoneNumber,
            telegramId,
            defaultBalance,
            newReferralCode,
            referrerId,
          ]
        );

        await connection.commit();

        await ctx.reply(
          `Thanks for registering! Your account has been created.`,
          {
            reply_markup: {
              keyboard: [
                ["🎮 Play Game", "💰 My Balance"],
                ["💵 Deposit", "💸 Withdraw"],
                ["📜 My Transactions", "👥 Referrals"],
                ["❓ Help"],
              ],
              resize_keyboard: true,
            },
          }
        );
      }
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error processing contact:", error);
    await ctx.reply("Sorry, something went wrong. Please try again later.");
  }
});

// Handle callback queries
bot.on("callback_query", async (ctx) => {
  const action = ctx.callbackQuery.data;
  const telegramId = ctx.from.id;
  const sessionData = sessions[telegramId] || {};

  try {
    // Deposit flow callbacks
    if (action === "deposit_telebirr") {
      sessions[telegramId] = {
        ...sessionData,
        depositMethod: "telebirr",
        depositState: "amount",
      };
      await ctx.answerCbQuery();
      await ctx.reply("Please enter the amount you want to deposit in ETB:", {
        reply_markup: { remove_keyboard: true },
      });
    } else if (action === "deposit_cbe") {
      sessions[telegramId] = {
        ...sessionData,
        depositMethod: "cbe",
        depositState: "amount",
      };
      await ctx.answerCbQuery();
      await ctx.reply("Please enter the amount you want to deposit in ETB:", {
        reply_markup: { remove_keyboard: true },
      });
    } else if (action === "cancel_deposit") {
      delete sessions[telegramId];
      await ctx.answerCbQuery();
      await ctx.reply("Deposit process cancelled.", {
        reply_markup: {
          keyboard: [
            ["🎮 Play Game", "💰 My Balance"],
            ["💵 Deposit", "💸 Withdraw"],
            ["📜 My Transactions", "❓ Help"],
          ],
          resize_keyboard: true,
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
      await ctx.reply("Please enter the amount you want to withdraw in ETB:", {
        reply_markup: { remove_keyboard: true },
      });
    } else if (action === "withdraw_cbe") {
      sessions[telegramId] = {
        ...sessionData,
        withdrawMethod: "cbe",
        withdrawState: "amount",
      };
      await ctx.answerCbQuery();
      await ctx.reply("Please enter the amount you want to withdraw in ETB:", {
        reply_markup: { remove_keyboard: true },
      });
    } else if (action === "cancel_withdraw") {
      delete sessions[telegramId];
      await ctx.answerCbQuery();
      await ctx.reply("Withdrawal process cancelled.", {
        reply_markup: {
          keyboard: [
            ["🎮 Play Game", "💰 My Balance"],
            ["💵 Deposit", "💸 Withdraw"],
            ["📜 My Transactions", "❓ Help"],
          ],
          resize_keyboard: true,
        },
      });
    } else if (action === "confirm_withdraw") {
      await ctx.answerCbQuery();

      const user = await getUserByTelegramId(telegramId);
      if (!user) {
        await ctx.reply(
          "Your account is not linked. Please play the game first to create an account."
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
        await ctx.reply(
          `✅ Your withdrawal request for ${withdrawAmount} ETB has been submitted successfully!\n\nNew balance: ${result.newBalance} ETB\n\nYour request is now pending approval by our team. You'll be notified once it's processed.`
        );
      } else {
        await ctx.reply(
          `❌ Failed to submit withdrawal request: ${result.message}`
        );
      }

      delete sessions[telegramId];

      // Show the main keyboard again
      await ctx.reply("What would you like to do next?", {
        reply_markup: {
          keyboard: [
            ["🎮 Play Game", "💰 My Balance"],
            ["💵 Deposit", "💸 Withdraw"],
            ["📜 My Transactions", "❓ Help"],
          ],
          resize_keyboard: true,
        },
      });
    } else if (action === "start_game") {
      const webappUrl = `${process.env.WEBAPP_URL}?tgUserId=${telegramId}`;

      await ctx.answerCbQuery();

      // For local/testing use (ngrok etc), Telegram may show a warning page.
      // Use a normal URL button instead of WebApp to avoid the Telegram WebApp warning.
      await ctx.reply("Open the game using the link below:", {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🎮 Open Game",
                url: webappUrl,
              },
            ],
          ],
        },
      });
    }
  } catch (error) {
    console.error("Error handling callback query:", error);
    ctx.reply("Sorry, there was an error. Please try again later.");
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
      await ctx.reply(
        `Game Results:\nScore: ${parsedData.score}\nWin: ${
          parsedData.win ? "Yes" : "No"
        }`
      );
    }
  } catch (error) {
    console.error("Error processing web app data:", error);
    ctx.reply("Sorry, there was an error processing your game data.");
  }
});

// Handle deposit command
bot.hears("💵 Deposit", async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    // Get user from database
    const user = await getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply(
        "Your account is not linked. Please play the game first to create an account."
      );
      return;
    }

    // Initialize deposit session
    sessions[telegramId] = { depositState: "method" };

    await ctx.reply("Please select your payment method:", {
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
    ctx.reply("Sorry, there was an error. Please try again later.");
  }
});

// Handle withdraw command
bot.hears("💸 Withdraw", async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    // Get user from database
    const user = await getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply(
        "Your account is not linked. Please play the game first to create an account."
      );
      return;
    }

    // Check if user has sufficient balance
    if (user.balance <= 0) {
      await ctx.reply(
        `You don't have enough balance to withdraw. Current balance: ${user.balance} ETB`
      );
      return;
    }

    // Initialize withdraw session
    sessions[telegramId] = { withdrawState: "method" };

    await ctx.reply(
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
    ctx.reply("Sorry, there was an error. Please try again later.");
  }
});

// Handle balance command
bot.hears("💰 My Balance", async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    // Get user from database
    const user = await getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply(
        "Your account is not linked. Please play the game first to create an account."
      );
      return;
    }

    await ctx.reply(`Your current balance is: ${user.balance} ETB`);
  } catch (error) {
    console.error("Error handling balance request:", error);
    ctx.reply("Sorry, there was an error. Please try again later.");
  }
});

// Handle transactions command
bot.hears("📜 My Transactions", async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    // Get user from database
    const user = await getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply(
        "Your account is not linked. Please play the game first to create an account."
      );
      return;
    }

    // Get user transactions
    const transactions = await paymentService.getUserTransactions(user.id, 5);

    if (transactions.length === 0) {
      await ctx.reply("You don't have any transactions yet.");
      return;
    }

    // Format transactions message
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

    await ctx.reply(message);
  } catch (error) {
    console.error("Error handling transactions request:", error);
    ctx.reply("Sorry, there was an error. Please try again later.");
  }
});

// Handle play game command
bot.hears("🎮 Play Game", async (ctx) => {
  const telegramId = ctx.from.id;
  const webappUrl = `${process.env.WEBAPP_URL}/login?tgUserId=${telegramId}`;

  // Use a regular URL button so Telegram doesn't force a WebApp warning page.
  await ctx.reply("Open the game using the link below:", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🎮 Open Game",
            url: webappUrl,
          },
        ],
      ],
    },
  });
});

// Handle help command
bot.hears("❓ Help", (ctx) => {
  ctx.reply(
    `
🎮 <b>Bingo Game Bot Help</b> 🎲

Available commands:
• 🎮 Play Game - Start playing Bingo
• 💰 My Balance - Check your current balance
• 💵 Deposit - Add funds to your account
• 💸 Withdraw - Withdraw funds from your account
• 📜 My Transactions - View your recent transactions
• 👥 Referrals - Manage your referrals and earn bonuses
• ❓ Help - Show this help message

Need further assistance? Contact support at support@broz.com
    `,
    { parse_mode: "HTML" }
  );
});

// Help command
bot.help((ctx) => {
  ctx.reply(
    `
🎮 <b>Bingo Game Bot Commands</b> 🎲

/start - Start the bot and get the main menu
/help - Show this help message

Use the keyboard buttons to navigate through the bot's features.
    `,
    { parse_mode: "HTML" }
  );
});

// Add handler for Referrals menu option
bot.hears("👥 Referrals", async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    // Get user data
    const user = await getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply(
        "Please create an account first by using the /start command."
      );
      return;
    }

    // Get referral data
    const referralData = await getUserReferralData(user.id);

    if (!referralData) {
      await ctx.reply(
        "Unable to retrieve referral information. Please try again later."
      );
      return;
    }

    // Build referral message with HTML formatting instead of Markdown
    let message = `🔗 <b>Your Referral Link</b>\n${referralData.referralLink}\n\n`;
    message += `🎁 <b>Referral Bonus</b>: ${referralData.settings.bonus_percentage}% of first deposit\n`;
    message += `💰 <b>Minimum Deposit</b>: ${referralData.settings.min_deposit_amount} ETB\n\n`;
    message += `👥 <b>Total Referred</b>: ${referralData.totalReferred}\n`;
    message += `💵 <b>Total Earnings</b>: ${referralData.totalEarnings} ETB\n\n`;

    // Add recent earnings if any
    if (referralData.earnings.length > 0) {
      message += `<b>Recent Earnings:</b>\n`;

      // Show up to 5 recent earnings
      const recentEarnings = referralData.earnings.slice(0, 5);

      recentEarnings.forEach((earning) => {
        const date = new Date(earning.created_at).toLocaleDateString();
        message += `- ${earning.amount} ETB from @${earning.referred_username} (${date})\n`;
      });
    } else {
      message += `<b>Share your referral link to earn bonuses!</b>\n`;
      message += `When someone joins using your link and makes their first deposit, you'll earn ${referralData.settings.bonus_percentage}% of their deposit amount.`;
    }

    // Send the message with option to copy the link
    await ctx.reply(message, {
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
    await ctx.reply(
      "Sorry, there was an error retrieving your referral information. Please try again later."
    );
  }
});

// Handle inline button for copying referral link
bot.action("copy_referral_link", async (ctx) => {
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
    await ctx.reply(referralData.referralLink);
  } catch (error) {
    console.error("Error copying referral link:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});

// Process deposit transaction handler
const processDepositTransaction = async (ctx, telegramId) => {
  const sessionData = sessions[telegramId];
  const { depositMethod, depositAmount, depositTransactionNumber } =
    sessionData;

  // Get user from database
  const user = await getUserByTelegramId(telegramId);

  if (!user) {
    await ctx.reply(
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
    // Process referral bonus if applicable
    const referralResult = await processReferralBonus(user.id);

    let message = `✅ Your deposit of ${depositAmount} ETB has been processed successfully!\n\nNew balance: ${result.newBalance} ETB`;

    // If a referral bonus was awarded, notify the referrer via Telegram
    if (referralResult.success) {
      try {
        // Get referrer telegram ID
        const [referrerData] = await db.execute(
          "SELECT telegram_id FROM users WHERE id = ?",
          [referralResult.referrerId]
        );

        if (referrerData.length > 0 && referrerData[0].telegram_id) {
          // Send notification to referrer
          bot.telegram.sendMessage(
            referrerData[0].telegram_id,
            `🎉 Congratulations! You've earned a referral bonus of ${referralResult.bonusAmount} ETB.`
          );
        }
      } catch (error) {
        console.error("Error sending referral notification:", error);
      }
    }

    await ctx.reply(message);
  } else {
    await ctx.reply(`❌ Failed to process deposit: ${result.message}`);
  }

  delete sessions[telegramId];

  // Show the main keyboard again
  await ctx.reply("What would you like to do next?", {
    reply_markup: {
      keyboard: [
        ["🎮 Play Game", "💰 My Balance"],
        ["💵 Deposit", "💸 Withdraw"],
        ["📜 My Transactions", "👥 Referrals"],
        ["❓ Help"],
      ],
      resize_keyboard: true,
    },
  });
};

// Handle regular messages for deposit/withdraw flows
bot.on("text", async (ctx) => {
  // If it's a command, ignore
  if (ctx.message.text.startsWith("/")) {
    return;
  }

  const messageText = ctx.message.text;
  const telegramId = ctx.from.id;
  const sessionData = sessions[telegramId] || {};

  // Handle deposit flow
  if (sessionData.depositState === "amount" && sessionData.depositMethod) {
    // Validate amount
    const amount = parseFloat(messageText);

    if (isNaN(amount) || amount <= 0) {
      await ctx.reply("Please enter a valid amount (greater than 0):");
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
      await ctx.reply(
        "Sorry, this payment method is currently unavailable. Please try another method."
      );
      delete sessions[telegramId];
      return;
    }

    let instructionsMessage;

    if (sessionData.depositMethod === "telebirr") {
      instructionsMessage = `Please follow these steps to deposit via Telebirr:\n\n1. Open your Telebirr app\n2. Select "Pay" or "Transfer"\n3. Enter the phone number: ${paymentDetails.account_number}\n4. Enter amount: ${amount} ETB\n5. Complete the payment\n6. Copy the transaction number from the confirmation message\n\nAfter completing the payment, please enter the transaction number here:`;
    } else {
      // CBE
      instructionsMessage = `Please follow these steps to deposit via CBE:\n\n1. Transfer ${amount} ETB to the following account:\n   - Account Number: ${paymentDetails.account_number}\n   - Account Name: ${paymentDetails.account_name}\n2. Keep the transaction reference number\n\nAfter completing the transfer, please enter the transaction reference number here:`;
    }

    await ctx.reply(instructionsMessage);
  } else if (
    sessionData.depositState === "instructions" &&
    sessionData.depositAmount
  ) {
    // This is the transaction number input
    if (!messageText || messageText.trim().length < 3) {
      await ctx.reply("Please enter a valid transaction number:");
      return;
    }

    // Update session with transaction number
    sessions[telegramId] = {
      ...sessionData,
      depositTransactionNumber: messageText.trim(),
      depositState: "processing",
    };

    // Process the deposit
    await processDepositTransaction(ctx, telegramId);
  }
  // Handle withdrawal flow
  else if (
    sessionData.withdrawState === "amount" &&
    sessionData.withdrawMethod
  ) {
    // Validate amount
    const amount = parseFloat(messageText);

    if (isNaN(amount) || amount <= 0) {
      await ctx.reply("Please enter a valid amount (greater than 0):");
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

    await ctx.reply(promptMessage);
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

      await ctx.reply(promptMessage);
      return;
    }

    // Update session with account number
    sessions[telegramId] = {
      ...sessionData,
      withdrawAccount: messageText.trim(),
      withdrawState: "name",
    };

    await ctx.reply("Please enter the account holder name (your full name):");
  } else if (
    sessionData.withdrawState === "name" &&
    sessionData.withdrawAccount
  ) {
    // Validate name
    if (!messageText || messageText.trim().length < 3) {
      await ctx.reply("Please enter a valid name:");
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

    await ctx.reply(confirmationMessage, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Confirm", callback_data: "confirm_withdraw" },
            { text: "❌ Cancel", callback_data: "cancel_withdraw" },
          ],
        ],
      },
    });
  } else {
    // Default response for non-command messages
    await ctx.reply(
      "You can start playing Bingo or manage your account using the buttons below:",
      {
        reply_markup: {
          keyboard: [
            ["🎮 Play Game", "💰 My Balance"],
            ["💵 Deposit", "💸 Withdraw"],
            ["📜 My Transactions", "❓ Help"],
          ],
          resize_keyboard: true,
        },
      }
    );
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

    // Send message using the bot
    await bot.telegram.sendMessage(userId, message);

    return res
      .status(200)
      .json({ success: true, message: "Message sent successfully" });
  } catch (error) {
    console.error("Error sending message:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to send message" });
  }
});

// API endpoint for admin to broadcast messages to all users
app.post("/api/telegram/broadcast", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res
        .status(400)
        .json({ success: false, message: "Message is required" });
    }

    // Get all users from database
    const [users] = await db.execute(
      "SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL"
    );

    if (!users || users.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No users found with Telegram IDs" });
    }

    // Send message to all users
    let successful = 0;
    let failed = 0;

    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.telegram_id, message);
        successful++;
      } catch (error) {
        console.error(
          `Failed to send message to user ${user.telegram_id}:`,
          error
        );
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

// Start the Express server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
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
