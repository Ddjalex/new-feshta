const express = require("express");
const router = express.Router();
const paymentService = require("../services/paymentService");
const db = require("../config/db");

// Middleware to check API key for admin routes
const checkApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
};

const { Telegraf } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

async function sendMessage(chatId, message) {
  try {
    await bot.telegram.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

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

    await sendMessage(telegram_id, message);

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
// Get payment settings
router.get("/settings", async (req, res) => {
  try {
    const settings = await paymentService.getAllPaymentSettings();
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    console.error("Error fetching payment settings:", error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching payment settings" });
  }
});

// Get payment settings by method
router.get("/settings/:method", async (req, res) => {
  try {
    const { method } = req.params;
    const settings = await paymentService.getPaymentSettings(method);

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: "Payment method not found or inactive",
      });
    }

    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    console.error("Error fetching payment settings:", error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching payment settings" });
  }
});

// Process deposit
router.post("/deposit", async (req, res) => {
  try {
    const { userId, paymentMethod, amount, transactionNumber } = req.body;

    if (!userId || !paymentMethod || !amount || !transactionNumber) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: userId, paymentMethod, amount, transactionNumber",
      });
    }

    const result = await paymentService.processDeposit(
      userId,
      paymentMethod,
      amount,
      transactionNumber
    );

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error("Error processing deposit:", error);
    res
      .status(500)
      .json({ success: false, message: "Error processing deposit" });
  }
});

// Create withdrawal request
router.post("/withdraw", async (req, res) => {
  try {
    const { userId, amount, paymentMethod, accountNumber, accountName } =
      req.body;

    if (
      !userId ||
      !amount ||
      !paymentMethod ||
      !accountNumber ||
      !accountName
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: userId, amount, paymentMethod, accountNumber, accountName",
      });
    }

    const result = await paymentService.createWithdrawalRequest(
      userId,
      amount,
      paymentMethod,
      accountNumber,
      accountName
    );

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error("Error creating withdrawal request:", error);
    res
      .status(500)
      .json({ success: false, message: "Error creating withdrawal request" });
  }
});

// Get user transactions
router.get("/transactions/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit } = req.query;

    const transactions = await paymentService.getUserTransactions(
      userId,
      limit || 10
    );

    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    console.error("Error fetching user transactions:", error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching user transactions" });
  }
});

// Get user withdrawal requests
router.get("/withdrawals/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit } = req.query;

    const withdrawals = await paymentService.getUserWithdrawalRequests(
      userId,
      limit || 10
    );

    res.status(200).json({ success: true, data: withdrawals });
  } catch (error) {
    console.error("Error fetching withdrawal requests:", error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching withdrawal requests" });
  }
});

// Admin routes

// Update payment settings
router.put("/settings/:id", checkApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentMethod, accountNumber, accountName, isActive } = req.body;

    await db.execute(
      `UPDATE payment_settings 
       SET payment_method = ?, account_number = ?, account_name = ?, is_active = ? 
       WHERE id = ?`,
      [paymentMethod, accountNumber, accountName, isActive, id]
    );

    res.status(200).json({
      success: true,
      message: "Payment settings updated successfully",
    });
  } catch (error) {
    console.error("Error updating payment settings:", error);
    res
      .status(500)
      .json({ success: false, message: "Error updating payment settings" });
  }
});

// Add new payment setting
router.post("/settings", checkApiKey, async (req, res) => {
  try {
    const { paymentMethod, accountNumber, accountName, isActive } = req.body;

    if (!paymentMethod || !accountNumber || !accountName) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: paymentMethod, accountNumber, accountName",
      });
    }

    const [result] = await db.execute(
      `INSERT INTO payment_settings (payment_method, account_number, account_name, is_active) 
       VALUES (?, ?, ?, ?)`,
      [paymentMethod, accountNumber, accountName, isActive || true]
    );

    res.status(201).json({
      success: true,
      message: "Payment setting added successfully",
      id: result.insertId,
    });
  } catch (error) {
    console.error("Error adding payment setting:", error);
    res
      .status(500)
      .json({ success: false, message: "Error adding payment setting" });
  }
});

// Get all withdrawal requests (admin)
router.get("/withdrawals", checkApiKey, async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT wr.id, wr.user_id, u.username, wr.amount, wr.payment_method, 
             wr.account_number, wr.account_name, wr.status, wr.created_at,
             wr.admin_transaction_number
      FROM withdrawal_requests wr
      JOIN users u ON wr.user_id = u.id
    `;

    const params = [];

    if (status) {
      query += " WHERE wr.status = ?";
      params.push(status);
    }

    query += " ORDER BY wr.created_at DESC";

    const [withdrawals] = await db.execute(query, params);

    res.status(200).json({ success: true, data: withdrawals });
  } catch (error) {
    console.error("Error fetching withdrawal requests:", error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching withdrawal requests" });
  }
});

// Process withdrawal request (admin)
router.put("/withdrawals/:id", checkApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminId, adminNote, transactionNumber } = req.body;

    if (!status || !adminId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: status, adminId",
      });
    }

    // Begin transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Get withdrawal request
      const [withdrawalRequests] = await connection.execute(
        "SELECT * FROM withdrawal_requests WHERE id = ?",
        [id]
      );

      if (withdrawalRequests.length === 0) {
        await connection.rollback();
        connection.release();
        return res
          .status(404)
          .json({ success: false, message: "Withdrawal request not found" });
      }

      const request = withdrawalRequests[0];

      // Check if already processed
      if (request.status !== "pending") {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: `Withdrawal request already ${request.status}`,
        });
      }

      // Update withdrawal request
      await connection.execute(
        `UPDATE withdrawal_requests 
         SET status = ?, admin_id = ?, admin_note = ?, admin_transaction_number = ? 
         WHERE id = ?`,
        [status, adminId, adminNote, transactionNumber, id]
      );

      // Update transaction status
      await connection.execute(
        "UPDATE transactions SET status = ? WHERE id = ?",
        [
          status === "completed" ? "completed" : "failed",
          request.transaction_id,
        ]
      );

      // If rejected, refund the amount
      if (status === "rejected") {
        await connection.execute(
          "UPDATE users SET balance = balance + ? WHERE id = ?",
          [request.amount, request.user_id]
        );
      }

      await connection.commit();

      res.status(200).json({
        success: true,
        message: `Withdrawal request ${status} successfully`,
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error processing withdrawal request:", error);
    res
      .status(500)
      .json({ success: false, message: "Error processing withdrawal request" });
  }
});

// Process manual deposit (admin)
router.post("/manual-deposit", checkApiKey, async (req, res) => {
  try {
    const { userId, adminId, amount, note } = req.body;

    if (!userId || !adminId || !amount) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId, adminId, amount",
      });
    }

    const result = await paymentService.processManualDeposit(
      userId,
      adminId,
      amount,
      note
    );

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error("Error processing manual deposit:", error);
    res
      .status(500)
      .json({ success: false, message: "Error processing manual deposit" });
  }
});

module.exports = router;
