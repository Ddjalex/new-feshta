const axios = require("axios");
const pool = require("../config/db");

const VALIDATION_API_BASE_URL = "http://196.189.61.138:4001";
// Adding a longer timeout for slow connections
const API_TIMEOUT = 60000; // 60 seconds

// Configure axios instance with security bypass options
const secureAxios = axios.create({
  timeout: API_TIMEOUT,
  headers: {
    Accept: "*/*",
    "User-Agent": "TelegramBotValidator/1.0",
    Connection: "keep-alive",
  },
  // Disable SSL verification for HTTP endpoints
  httpsAgent: new (require("https").Agent)({
    rejectUnauthorized: false,
  }),
});

// Get active payment settings for a specific payment method
const getPaymentSettings = async (paymentMethod) => {
  const result = await pool.query(
    "SELECT * FROM payment_settings WHERE payment_method = $1 AND status = 'active' LIMIT 1",
    [paymentMethod]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
};

// Get all active payment settings
const getAllPaymentSettings = async () => {
  const result = await pool.query(
    "SELECT * FROM payment_settings WHERE status = 'active'"
  );
  return result.rows;
};

// Create a transaction record
const createTransaction = async (
  userId,
  type,
  paymentMethod,
  amount,
  txnNumber = null
) => {
  const result = await pool.query(
    `INSERT INTO transactions 
     (user_id, transaction_type, payment_method, amount, transaction_number) 
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, type, paymentMethod, amount, txnNumber]
  );
  return result.rows[0].id;
};

// Update user balance
const updateUserBalance = async (userId, amount) => {
  await pool.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [
    amount,
    userId,
  ]);

  // Get updated balance
  const result = await pool.query("SELECT balance FROM users WHERE id = $1", [
    userId,
  ]);

  return result.rows[0]?.balance || 0;
};

// Fallback manual validation for testing/when API is down
const manualValidation = async (transactionNumber) => {
  // Simple fallback validation - just checks if transaction number follows expected format
  // In production, this should be replaced with a proper validation mechanism

  if (!transactionNumber || typeof transactionNumber !== "string") {
    return {
      success: false,
      message: "Invalid transaction number format",
    };
  }

  // Basic validation - transaction number should be at least 6 characters
  if (transactionNumber.length < 6) {
    return {
      success: false,
      message: "Transaction number is too short",
    };
  }

  // For testing purposes, assume transaction is valid
  return {
    success: true,
    message: "Transaction validated successfully (fallback mode)",
    transactionDetails: {
      amount: "Unknown",
      date: new Date().toISOString(),
      status: "completed",
      note: "Validated using fallback mechanism",
    },
  };
};

// Validate Telebirr transaction
const validateTelebirrTransaction = async (transactionNumber) => {
  try {
    console.log(
      "Starting Telebirr validation for transaction:",
      transactionNumber
    );
    const endpoint = `${VALIDATION_API_BASE_URL}/api/telebirr/${transactionNumber}`;
    console.log("Calling validation API:", endpoint);

    let response;
    try {
      // Try POST first
      console.log("Attempting POST request to validation API");
      response = await secureAxios.post(endpoint);
    } catch (postError) {
      console.log(
        "POST request failed, trying GET request instead:",
        postError.message
      );
      // If POST fails, try GET
      response = await secureAxios.get(endpoint);
    }

    console.log(
      "Validation API Response:",
      JSON.stringify(response.data, null, 2)
    );

    if (response.data && response.data.success) {
      // Validate the response contains necessary details
      if (!response.data.transactionDetails) {
        console.log("Error: Missing transaction details in response");
        return {
          success: false,
          message:
            "Invalid transaction details received from validation service",
        };
      }

      console.log(
        "Transaction details received:",
        response.data.transactionDetails
      );
      // Successfully validated
      return {
        success: true,
        message: response.data.message || "Transaction validated successfully",
        transactionDetails: response.data.transactionDetails,
      };
    } else {
      console.log("Validation failed:", response.data.message);
      return {
        success: false,
        message: response.data.message || "Transaction validation failed",
      };
    }
  } catch (error) {
    console.error("Telebirr validation error details:", {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      data: error.response?.data,
      url: error.config?.url,
      method: error.config?.method,
    });

    if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
      console.log("Connection timeout - internet might be slow");
      return {
        success: false,
        message:
          "Validation service is taking too long to respond. Please try again later.",
      };
    }

    if (
      error.code === "ECONNREFUSED" ||
      error.code === "ENOTFOUND" ||
      (error.response && error.response.status === 404)
    ) {
      console.log("Connection error or endpoint not found");

      // Try alternative URL formats as a fallback
      try {
        console.log("Trying alternative URL format...");
        const altEndpoint = `${VALIDATION_API_BASE_URL}/telebirr/validate/${transactionNumber}`;
        console.log("Calling alternative API:", altEndpoint);
        const altResponse = await secureAxios.get(altEndpoint);

        console.log(
          "Alternative API Response:",
          JSON.stringify(altResponse.data, null, 2)
        );

        if (altResponse.data && altResponse.data.success) {
          return {
            success: true,
            message:
              altResponse.data.message || "Transaction validated successfully",
            transactionDetails: altResponse.data.transactionDetails || {
              amount: "Unknown",
              date: new Date().toISOString(),
              status: "completed",
            },
          };
        }
      } catch (altError) {
        console.log("Alternative URL also failed:", altError.message);
      }

      return {
        success: false,
        message:
          "Validation service is currently unavailable. Please try again later or contact support.",
      };
    }

    if (error.response && error.response.data) {
      console.log("API returned error response:", error.response.data);
      return {
        success: false,
        message: error.response.data.message || "Transaction validation failed",
      };
    }

    return {
      success: false,
      message: error.message || "Failed to validate transaction",
    };
  }
};

// Validate CBE transaction
const validateCBETransaction = async (transactionNumber) => {
  try {
    console.log("Starting CBE validation for transaction:", transactionNumber);
    const endpoint = `${VALIDATION_API_BASE_URL}/api/cbe/${transactionNumber}`;
    console.log("Calling validation API:", endpoint);

    let response;
    try {
      // Try POST first
      console.log("Attempting POST request to validation API");
      response = await secureAxios.post(endpoint);
    } catch (postError) {
      console.log(
        "POST request failed, trying GET request instead:",
        postError.message
      );
      // If POST fails, try GET
      response = await secureAxios.get(endpoint);
    }

    console.log(
      "Validation API Response:",
      JSON.stringify(response.data, null, 2)
    );

    if (response.data && response.data.success) {
      // Validate the response contains necessary details
      if (!response.data.transactionDetails) {
        console.log("Error: Missing transaction details in response");
        return {
          success: false,
          message:
            "Invalid transaction details received from validation service",
        };
      }

      console.log(
        "Transaction details received:",
        response.data.transactionDetails
      );
      // Successfully validated
      return {
        success: true,
        message: response.data.message || "Transaction validated successfully",
        transactionDetails: response.data.transactionDetails,
      };
    } else {
      console.log("Validation failed:", response.data.message);
      return {
        success: false,
        message: response.data.message || "Transaction validation failed",
      };
    }
  } catch (error) {
    console.error("CBE validation error details:", {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      data: error.response?.data,
      url: error.config?.url,
      method: error.config?.method,
    });

    if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
      console.log("Connection timeout - internet might be slow");
      return {
        success: false,
        message:
          "Validation service is taking too long to respond. Please try again later.",
      };
    }

    if (
      error.code === "ECONNREFUSED" ||
      error.code === "ENOTFOUND" ||
      (error.response && error.response.status === 404)
    ) {
      console.log("Connection error or endpoint not found");

      // Try alternative URL formats as a fallback
      try {
        console.log("Trying alternative URL format...");
        const altEndpoint = `${VALIDATION_API_BASE_URL}/cbe/validate/${transactionNumber}`;
        console.log("Calling alternative API:", altEndpoint);
        const altResponse = await secureAxios.get(altEndpoint);

        console.log(
          "Alternative API Response:",
          JSON.stringify(altResponse.data, null, 2)
        );

        if (altResponse.data && altResponse.data.success) {
          return {
            success: true,
            message:
              altResponse.data.message || "Transaction validated successfully",
            transactionDetails: altResponse.data.transactionDetails || {
              amount: "Unknown",
              date: new Date().toISOString(),
              status: "completed",
            },
          };
        }
      } catch (altError) {
        console.log("Alternative URL also failed:", altError.message);
      }

      return {
        success: false,
        message:
          "Validation service is currently unavailable. Please try again later or contact support.",
      };
    }

    if (error.response && error.response.data) {
      console.log("API returned error response:", error.response.data);
      return {
        success: false,
        message: error.response.data.message || "Transaction validation failed",
      };
    }

    return {
      success: false,
      message: error.message || "Failed to validate transaction",
    };
  }
};

// Process deposit transaction
const processDeposit = async (
  userId,
  paymentMethod,
  amount,
  transactionNumber
) => {
  try {
    // Check if transaction already exists to prevent duplicates
    const result = await pool.query(
      'SELECT id FROM transactions WHERE transaction_number = $1 AND transaction_type = $2',
      [transactionNumber, "deposit"]
    );

    if (result.rows.length > 0) {
      return {
        success: false,
        message: "This transaction has already been processed",
      };
    }

    // Validate transaction
    let validationResult;
    try {
      if (paymentMethod === "telebirr") {
        validationResult = await validateTelebirrTransaction(transactionNumber);
      } else if (paymentMethod === "cbe") {
        validationResult = await validateCBETransaction(transactionNumber);
      } else {
        return {
          success: false,
          message: "Invalid payment method",
        };
      }
    } catch (validationError) {
      console.error("Validation error:", validationError);
      return {
        success: false,
        message:
          "Transaction validation failed. Please try again later or contact support.",
      };
    }

    if (!validationResult || !validationResult.success) {
      return (
        validationResult || {
          success: false,
          message: "Unknown validation error",
        }
      );
    }

    // Check if amount matches between request and validation result
    if (validationResult.transactionDetails) {
      let apiAmount = null;

      if (
        paymentMethod === "cbe" &&
        validationResult.transactionDetails.transferredAmount
      ) {
        // Extract the numeric part from "5,000.00 ETB" format
        const amountString =
          validationResult.transactionDetails.transferredAmount;
        apiAmount = parseFloat(amountString.replace(/[^\d.-]/g, ""));
      } else if (
        paymentMethod === "telebirr" &&
        validationResult.transactionDetails.amount
      ) {
        apiAmount = parseFloat(validationResult.transactionDetails.amount);
      }

      // Only check if we were able to extract an amount
      if (apiAmount !== null) {
        // Allow a small tolerance (0.01) for floating point comparison
        if (Math.abs(apiAmount - amount) > 0.01) {
          console.log(
            `Amount mismatch: requested ${amount}, validated ${apiAmount}`
          );
          return {
            success: false,
            message:
              "Transaction amount doesn't match the requested deposit amount",
          };
        }
      } else {
        console.log(
          "Could not extract amount from validation response:",
          validationResult.transactionDetails
        );
      }
    }

    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Create transaction record
      const transactionId = await createTransaction(
        userId,
        "deposit",
        paymentMethod,
        amount,
        transactionNumber
      );
      // Update transaction status to completed
      await client.query(
        "UPDATE transactions SET status = $1 WHERE id = $2",
        ["completed", transactionId]
      );
      // Update user balance
      const newBalance = await updateUserBalance(userId, amount);
      await client.query('COMMIT');
      return {
        success: true,
        message: "Deposit processed successfully",
        transactionId: transactionId,
        newBalance: newBalance,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error processing deposit:", error);
    return {
      success: false,
      message: error.message || "Failed to process deposit",
      error: error.message,
    };
  }
};

// Create withdrawal request
const createWithdrawalRequest = async (
  userId,
  amount,
  paymentMethod,
  accountNumber,
  accountName
) => {
  try {
    // Check if user has sufficient balance
    const userResult = await pool.query("SELECT balance FROM users WHERE id = $1", [
      userId,
    ]);
    const user = userResult.rows;
    if (!user.length || user[0].balance < amount) {
      return {
        success: false,
        message: "Insufficient balance",
      };
    }

    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Create transaction record (pending)
      const transactionId = await createTransaction(
        userId,
        "withdrawal",
        paymentMethod,
        -amount
      );
      // Create withdrawal request
      const result = await client.query(
        `INSERT INTO withdrawal_requests 
         (user_id, amount, payment_method, account_number, account_name, transaction_id) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          userId,
          amount,
          paymentMethod,
          accountNumber,
          accountName,
          transactionId,
        ]
      );
      // Reserve the amount (deduct from balance)
      await client.query(
        "UPDATE users SET balance = balance - $1 WHERE id = $2",
        [amount, userId]
      );
      await client.query('COMMIT');
      // Get updated balance
      const updatedUser = await pool.query(
        "SELECT balance FROM users WHERE id = $1",
        [userId]
      );
      return {
        success: true,
        message: "Withdrawal request submitted successfully",
        requestId: result.rows[0].id,
        newBalance: updatedUser.rows[0].balance,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error creating withdrawal request:", error);
    return {
      success: false,
      message: "Failed to create withdrawal request",
      error: error.message,
    };
  }
};

// Get user transactions
const getUserTransactions = async (userId, limit = 10) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.transaction_type, t.payment_method, t.amount, 
              t.transaction_number, t.status, t.created_at,
              CASE 
                WHEN t.transaction_type = 'withdrawal' AND t.status = 'pending' THEN 
                  (SELECT wr.status FROM withdrawal_requests wr WHERE wr.transaction_id = t.id)
                ELSE t.status
              END AS actual_status
       FROM transactions t
       WHERE t.user_id = $1 AND t.transaction_type IN ('deposit', 'withdrawal', 'manual_deposit')
       ORDER BY t.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error("Error fetching user transactions:", error);
    throw error;
  }
};

// Get user withdrawal requests
const getUserWithdrawalRequests = async (userId, limit = 10) => {
  try {
    const result = await pool.query(
      `SELECT wr.id, wr.amount, wr.payment_method, wr.account_number, 
              wr.status, wr.created_at, wr.admin_transaction_number
       FROM withdrawal_requests wr
       WHERE wr.user_id = $1
       ORDER BY wr.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error("Error fetching withdrawal requests:", error);
    throw error;
  }
};

// Process manual deposit by admin
const processManualDeposit = async (userId, adminId, amount, note) => {
  try {
    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Create transaction record
      const transactionResult = await client.query(
        `INSERT INTO transactions 
         (user_id, transaction_type, payment_method, amount, status, reference_number) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [userId, "manual_deposit", "system", amount, "completed", note]
      );
      // Update user balance
      await client.query(
        "UPDATE users SET balance = balance + $1 WHERE id = $2",
        [amount, userId]
      );
      await client.query('COMMIT');
      // Get updated balance
      const updatedUser = await pool.query(
        "SELECT balance FROM users WHERE id = $1",
        [userId]
      );
      return {
        success: true,
        message: "Manual deposit processed successfully",
        transactionId: transactionResult.rows[0].id,
        newBalance: updatedUser.rows[0].balance,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error processing manual deposit:", error);
    return {
      success: false,
      message: "Failed to process manual deposit",
      error: error.message,
    };
  }
};

module.exports = {
  getPaymentSettings,
  getAllPaymentSettings,
  validateTelebirrTransaction,
  validateCBETransaction,
  processDeposit,
  createWithdrawalRequest,
  getUserTransactions,
  getUserWithdrawalRequests,
  processManualDeposit,
};
