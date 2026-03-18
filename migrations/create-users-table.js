require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log("Starting migration: Creating users table (PostgreSQL)...");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        email VARCHAR(255),
        phone_number VARCHAR(50),
        balance NUMERIC(12,2) NOT NULL DEFAULT 0,
        telegram_id VARCHAR(100),
        telegram_username VARCHAR(100),
        referral_code VARCHAR(50),
        referred_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT idx_telegram_id UNIQUE (telegram_id),
        CONSTRAINT idx_phone_number UNIQUE (phone_number)
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
