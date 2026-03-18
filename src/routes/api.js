const express = require("express");
const router = express.Router();
const { verifyApiKey } = require("../middleware/auth");
const { sendMessage } = require("../services/telegramService");

/**
 * Send withdrawal status notification
 * @route POST /api/notify-withdrawal-status
 * @access Private
 */
router.post("/notify-withdrawal-status", async (req, res) => {
  try {
    const { telegram_id, amount, status, transaction_number, note } = req.body;

    if (!telegram_id || !amount || !status) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    let message = `🔄 *Withdrawal Status Update*\n\n`;
    message += `Amount: ${amount} ETB\n`;
    message += `Status: ${status.toUpperCase()}\n`;

    if (transaction_number) {
      message += `Transaction Number: ${transaction_number}\n`;
    }

    if (note) {
      message += `\nNote: ${note}`;
    }

    // Send message to user
    await sendMessage(telegram_id, message, { parse_mode: "Markdown" });

    res.json({
      success: true,
      message: "Withdrawal status notification sent successfully",
    });
  } catch (error) {
    console.error("Error sending withdrawal status notification:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send withdrawal status notification",
    });
  }
});

module.exports = router;
