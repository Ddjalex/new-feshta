const db = require("../config/db");

/**
 * Verify user by Telegram ID
 * @param {string} telegramId - Telegram user ID
 * @returns {Promise<Object|null>} - User data or null if not found
 */
const verifyUserByTelegramId = async (telegramId) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, username, phone_number, balance, telegram_id FROM users WHERE telegram_id = ?",
      [telegramId]
    );

    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error("Error verifying user by Telegram ID:", error);
    return null;
  }
};

/**
 * Verify phone number and Telegram ID match
 * @param {string} phoneNumber - User phone number
 * @param {string} telegramId - Telegram user ID
 * @returns {Promise<Object>} - Verification result
 */
const verifyPhoneAndTelegramId = async (phoneNumber, telegramId) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, username, phone_number, balance, telegram_id FROM users WHERE phone_number = ? AND telegram_id = ?",
      [phoneNumber, telegramId]
    );

    if (rows.length === 0) {
      return {
        success: false,
        message: "No user found with this phone number and Telegram ID",
      };
    }

    return {
      success: true,
      user: rows[0],
    };
  } catch (error) {
    console.error("Error verifying phone and Telegram ID:", error);
    return {
      success: false,
      message: "Error verifying user",
    };
  }
};

module.exports = {
  verifyUserByTelegramId,
  verifyPhoneAndTelegramId,
};
