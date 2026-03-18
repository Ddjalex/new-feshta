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
    console.log(
      "Starting migration: Adding phone_number field to users table..."
    );

    // Check if phone_number column already exists
    const [columns] = await pool.execute(
      `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone_number'
    `,
      [process.env.DB_NAME]
    );

    if (columns.length === 0) {
      // Add phone_number column if it doesn't exist
      await pool.execute(`
        ALTER TABLE users
        ADD COLUMN phone_number VARCHAR(20) NULL,
        ADD UNIQUE INDEX idx_phone_number (phone_number)
      `);
      console.log("Added phone_number column to users table");
    } else {
      console.log("phone_number column already exists in users table");
    }

    // Update authentication fields
    await pool.execute(`
      ALTER TABLE users
      MODIFY COLUMN password VARCHAR(255) NULL,
      MODIFY COLUMN email VARCHAR(255) NULL
    `);
    console.log("Updated authentication fields in users table");

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
