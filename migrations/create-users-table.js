require("dotenv").config();
const mysql = require("mysql2/promise");

async function main() {
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
    console.log("Starting migration: Creating users table...");

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        email VARCHAR(255),
        phone_number VARCHAR(50) NULL,
        balance DECIMAL(12,2) NOT NULL DEFAULT 0,
        telegram_id VARCHAR(100) NULL,
        telegram_username VARCHAR(100) NULL,
        referral_code VARCHAR(50) NULL,
        referred_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_telegram_id (telegram_id),
        INDEX idx_phone_number (phone_number)
      )
    `);

    console.log("Created (or verified) users table.");
    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Error during migration:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main()
  .then(() => {
    console.log("Migration script executed successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error running migration script:", err);
    process.exit(1);
  });
