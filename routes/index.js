const express = require("express");
const router = express.Router();
const db = require("../config/db");
const paymentRoutes = require("./paymentRoutes");
const paymentService = require("../services/paymentService");

// User verification endpoint
router.post("/verify-user", async (req, res) => {
  try {
    const { phone_number, telegram_id } = req.body;

    if (!phone_number || !telegram_id) {
      return res.status(400).json({
        success: false,
        message: "Phone number and Telegram ID are required",
      });
    }

    // Check if user exists with given phone number and telegram ID
    const [users] = await db.execute(
      "SELECT * FROM users WHERE phone_number = ? AND telegram_id = ?",
      [phone_number, telegram_id]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "User verification failed",
      });
    }

    // User verified
    return res.json({
      success: true,
      message: "User verified successfully",
      userId: users[0].id,
    });
  } catch (error) {
    console.error("Error verifying user:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during verification",
    });
  }
});

// Validate transaction endpoint
router.post("/validate-transaction", async (req, res) => {
  try {
    const { payment_method, transaction_number } = req.body;

    if (!payment_method || !transaction_number) {
      return res.status(400).json({
        success: false,
        message: "Payment method and transaction number are required",
      });
    }

    let validationResult;
    if (payment_method === "telebirr") {
      validationResult = await paymentService.validateTelebirrTransaction(
        transaction_number
      );
    } else if (payment_method === "cbe") {
      validationResult = await paymentService.validateCBETransaction(
        transaction_number
      );
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
    }

    return res.json(validationResult);
  } catch (error) {
    console.error("Error validating transaction:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during validation",
    });
  }
});

// Deposit endpoint
router.post("/deposit", async (req, res) => {
  // Existing implementation
});

// Withdraw endpoint
router.post("/withdraw", async (req, res) => {
  // Existing implementation
});

module.exports = router;
