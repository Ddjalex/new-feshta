require("dotenv").config();
const mysql = require("mysql2/promise");

// Create MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test database connection and print helpful guidance if it fails
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log("Database connection successful");
    connection.release();
  } catch (error) {
    console.error("Error connecting to database:");
    console.error("  Host:", process.env.DB_HOST);
    console.error("  Port:", process.env.DB_PORT || 3306);
    console.error("  User:", process.env.DB_USER);
    console.error(
      "  Make sure MySQL is running and the credentials are correct."
    );
    console.error(error);
  }
}

// Call the test function when the file is first loaded
testConnection();

module.exports = pool;
