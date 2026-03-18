const express = require("express");
const path = require("path");
const xlsx = require("xlsx");
const router = express.Router();
const db = require("../config/db");
const telegramAuthService = require("../services/telegramAuthService");

// Middleware to check API key for admin routes
const checkApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
};

// Get all users (including those not linked to Telegram yet)
router.get("/users", checkApiKey, async (req, res) => {
  try {
    const { rows: users } = await db.query(
      "SELECT id, username, phone_number, telegram_id, created_at FROM users ORDER BY created_at DESC LIMIT 500"
    );
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ success: false, message: "Error fetching users" });
  }
});

// Import a single user from the users-2025 Excel file (by phone number or user ID)
router.post("/import-user", checkApiKey, async (req, res) => {
  try {
    const { phoneNumber, userId } = req.body;

    if (!phoneNumber && !userId) {
      return res.status(400).json({
        success: false,
        message: "Provide either phoneNumber or userId to import",
      });
    }

    const excelPath = path.join(__dirname, "..", "users-2025-10-22.xlsx");
    const workbook = xlsx.readFile(excelPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

    const match = rows.find((row) => {
      if (phoneNumber && String(row["Phone Number"]) === String(phoneNumber)) {
        return true;
      }
      if (userId && String(row["User ID"]) === String(userId)) {
        return true;
      }
      return false;
    });

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "User not found in the Excel file",
      });
    }

    const username = match["Email"] || match["Name"] || null;
    const phone = match["Phone Number"] || null;
    const balance = parseFloat(match["Balance"] || 0) || 0;
    const joinedDate = match["Joined Date"] ? new Date(match["Joined Date"]) : null;

    // If we already have a user with the same phone number, update it
      const { rows: existing } = await db.query(
        "SELECT id FROM users WHERE phone_number = $1 LIMIT 1",
        [phone]
      );

    if (existing.length > 0) {
      const userIdToUpdate = existing[0].id;
        await db.query(
          "UPDATE users SET username = $1, phone_number = $2, balance = $3, updated_at = NOW() WHERE id = $4",
          [username, phone, balance, userIdToUpdate]
        );

      return res.json({
        success: true,
        message: "Existing user updated from Excel data",
        userId: userIdToUpdate,
      });
    }

    const insertValues = [username, phone, balance, joinedDate ? joinedDate.toISOString().slice(0, 19).replace("T", " ") : null];

      const result = await db.query(
        "INSERT INTO users (username, phone_number, balance, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
        insertValues
      );

    return res.json({
      success: true,
      message: "User imported from Excel",
        userId: result.rows[0].id,
    });
  } catch (error) {
    console.error("Error importing user from Excel:", error);
    res.status(500).json({
      success: false,
      message: "Error importing user from Excel",
    });
  }
});

// Link user account with Telegram
router.post("/link-account", async (req, res) => {
  try {
    const { userId, telegramId, telegramUsername } = req.body;

    if (!userId || !telegramId) {
      return res.status(400).json({
        success: false,
        message: "User ID and Telegram ID are required",
      });
    }

    // Check if user exists
      const { rows: userRows } = await db.query("SELECT id FROM users WHERE id = $1", [
        userId,
      ]);
    if (userRows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Update user with Telegram info
      await db.query(
        "UPDATE users SET telegram_id = $1, telegram_username = $2 WHERE id = $3",
        [telegramId, telegramUsername, userId]
      );

    res
      .status(200)
      .json({ success: true, message: "Account linked successfully" });
  } catch (error) {
    console.error("Error linking account:", error);
    res.status(500).json({ success: false, message: "Error linking account" });
  }
});

// Bot broadcast message to all users
router.post("/bot-broadcast", checkApiKey, async (req, res) => {
  try {
    const { message, includeStartButton } = req.body;

    if (!message) {
      return res
        .status(400)
        .json({ success: false, message: "Message is required" });
    }

    // Get the bot instance from the app
    const bot = req.app.get("botInstance");

    if (!bot) {
      return res.status(500).json({
        success: false,
        message: "Bot instance not available",
      });
    }

    // Get all users from database
      const { rows: users } = await db.query(
        "SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL"
      );

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No users found with Telegram IDs",
      });
    }

    // Send message to all users
    let successful = 0;
    let failed = 0;

    for (const user of users) {
      try {
        // Prepare message options
        const options = {};

        // Add inline keyboard if requested
        if (includeStartButton) {
          options.reply_markup = {
            inline_keyboard: [
              [
                {
                  text: "🎮 Start App",
                  web_app: { url: process.env.WEBAPP_URL },
                },
              ],
            ],
          };
        }

        // Send message through the bot
        await bot.telegram.sendMessage(user.telegram_id, message, options);
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
    return res.status(500).json({
      success: false,
      message: "Failed to broadcast message",
    });
  }
});

// Get user details by Telegram ID
router.get("/user/:telegramId", async (req, res) => {
  try {
    const { telegramId } = req.params;

    if (!telegramId) {
      return res
        .status(400)
        .json({ success: false, message: "Telegram ID is required" });
    }

      const { rows: userRows } = await db.query(
        "SELECT id, username, email, balance, created_at FROM users WHERE telegram_id = $1",
        [telegramId]
      );

    if (userRows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, data: userRows[0] });
  } catch (error) {
    console.error("Error fetching user details:", error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching user details" });
  }
});

// Get user's game history
router.get("/user/:telegramId/games", async (req, res) => {
  try {
    const { telegramId } = req.params;

    if (!telegramId) {
      return res
        .status(400)
        .json({ success: false, message: "Telegram ID is required" });
    }

    // Get user ID from telegram ID
      const { rows: userRows } = await db.query(
        "SELECT id FROM users WHERE telegram_id = $1",
        [telegramId]
      );

    if (userRows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const userId = userRows[0].id;

    // Get user's game history
      const { rows: gameRows } = await db.query(
        `SELECT g.id, g.name, g.game_type_id, g.start_time, g.end_time, g.status, 
         p.is_winner, p.prize_amount 
         FROM games g 
         JOIN participants p ON g.id = p.game_id 
         WHERE p.user_id = $1 
         ORDER BY g.start_time DESC LIMIT 10`,
        [userId]
      );

    res.status(200).json({ success: true, data: gameRows });
  } catch (error) {
    console.error("Error fetching game history:", error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching game history" });
  }
});

// Add a new route for verifying users by Telegram ID only (for Mini App)
router.post("/verify-telegram-id", async (req, res) => {
  try {
    const { telegram_id } = req.body;

    if (!telegram_id) {
      return res.status(400).json({
        success: false,
        message: "Telegram ID is required",
      });
    }

    const user = await telegramAuthService.verifyUserByTelegramId(telegram_id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found with this Telegram ID",
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        phone_number: user.phone_number,
        balance: user.balance,
        telegram_id: user.telegram_id,
      },
    });
  } catch (error) {
    console.error("Error verifying Telegram ID:", error);
    res.status(500).json({
      success: false,
      message: "Server error during verification",
    });
  }
});

module.exports = router;
