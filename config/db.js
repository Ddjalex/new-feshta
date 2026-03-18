require("dotenv").config();
const { Pool } = require("pg");

// Create PostgreSQL connection pool (Neon compatible)
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }, // Neon requires SSL
});

// Test database connection and print helpful guidance if it fails
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("PostgreSQL database connection successful");
    client.release();
  } catch (error) {
    console.error("Error connecting to PostgreSQL database:");
    console.error("  Host:", process.env.DB_HOST);
    console.error("  Port:", process.env.DB_PORT || 5432);
    console.error("  User:", process.env.DB_USER);
    console.error(
      "  Make sure your Neon/Postgres database is running and credentials are correct."
    );
    console.error(error);
  }
}

// Call the test function when the file is first loaded
testConnection();

module.exports = pool;
