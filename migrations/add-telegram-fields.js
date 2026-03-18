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
    console.log("Starting migration: Adding Telegram fields to users table...");

    // Check if telegram_id column already exists
    const [columns] = await pool.execute(`
      SHOW COLUMNS FROM users LIKE 'telegram_id'
    `);

    if (columns.length === 0) {
      // Add telegram_id and telegram_username columns
      await pool.execute(`
        ALTER TABLE users 
        ADD COLUMN telegram_id VARCHAR(100) NULL AFTER email,
        ADD COLUMN telegram_username VARCHAR(100) NULL AFTER telegram_id,
        ADD INDEX idx_telegram_id (telegram_id)
      `);

      console.log("Successfully added Telegram fields to users table.");
    } else {
      console.log("Telegram fields already exist in users table.");
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
