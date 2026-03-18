require("dotenv").config();
const mysql = require("mysql2/promise");

async function main() {
  // Create connection pool
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  try {
    console.log("Starting migration: Adding payment-related tables...");

    // Create payment_settings table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS payment_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        payment_method ENUM('telebirr', 'cbe') NOT NULL,
        account_number VARCHAR(50) NOT NULL,
        account_name VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log("Created payment_settings table");

    // Create transactions table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        transaction_type ENUM('deposit', 'withdrawal', 'manual_deposit', 'game_win', 'game_entry') NOT NULL,
        payment_method ENUM('telebirr', 'cbe', 'system') NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        transaction_number VARCHAR(50),
        reference_number VARCHAR(50),
        status ENUM('pending', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
        response_data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_transaction_type (transaction_type),
        INDEX idx_status (status)
      )
    `);
    console.log("Created transactions table");

    // Create withdrawal_requests table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        payment_method ENUM('telebirr', 'cbe') NOT NULL,
        account_number VARCHAR(50) NOT NULL,
        account_name VARCHAR(100) NOT NULL,
        status ENUM('pending', 'completed', 'rejected') NOT NULL DEFAULT 'pending',
        transaction_id INT,
        admin_id INT,
        admin_note TEXT,
        admin_transaction_number VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_status (status)
      )
    `);
    console.log("Created withdrawal_requests table");

    // Add default payment settings
    const [existingSettings] = await pool.execute(
      "SELECT * FROM payment_settings LIMIT 1"
    );

    if (existingSettings.length === 0) {
      await pool.execute(`
        INSERT INTO payment_settings (payment_method, account_number, account_name, is_active) 
        VALUES ('telebirr', '251900000000', 'Bingo Game Official', TRUE)
      `);

      await pool.execute(`
        INSERT INTO payment_settings (payment_method, account_number, account_name, is_active) 
        VALUES ('cbe', '1000123456789', 'Bingo Game Official', TRUE)
      `);

      console.log("Added default payment settings");
    }

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Error during migration:", error);
    process.exit(1);
  } finally {
    // Close the connection pool
    await pool.end();
  }
}

// Run the migration
main()
  .then(() => {
    console.log("Migration script executed successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error running migration script:", err);
    process.exit(1);
  });
