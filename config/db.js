require("dotenv").config();
const { Pool } = require("pg");

// Build Neon-compatible connection string with endpoint fallback
function ensureNeonConnectionString(urlString) {
  if (!urlString) return urlString;

  try {
    const url = new URL(urlString);

    // If Neon, include endpoint option in URL query when missing
    if (url.hostname && url.hostname.endsWith(".neon.tech")) {
      const currentOptions = url.searchParams.get("options");
      if (!currentOptions || !currentOptions.includes("endpoint")) {
        const endpointId = url.hostname.split(".")[0];
        if (endpointId) {
          url.searchParams.set("options", `endpoint=${encodeURIComponent(endpointId)}`);
        }
      }
    }

    return url.toString();
  } catch (error) {
    console.warn("Warning: Could not parse DATABASE_URL, using raw value.", error.message);
    return urlString;
  }
}

const rawDatabaseUrl = process.env.DATABASE_URL;
const databaseUrl = ensureNeonConnectionString(rawDatabaseUrl);

// Create PostgreSQL connection pool (Neon compatible)
const poolConfig = databaseUrl
  ? {
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
    }
  : {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: false }, // Neon requires SSL
    };

const pool = new Pool(poolConfig);

// Helper to convert MySQL-style ? placeholders to Postgres $n placeholders
function convertPlaceholders(sql, params = []) {
  if (!sql.includes('?')) {
    return { sql, params };
  }

  let index = 0;
  const converted = sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });

  return { sql: converted, params };
}

// Add convenience wrapper for execute() (MySQL-style compatibility)
const dbClient = {
  query: (text, params) => {
    const { sql, params: convertedParams } = convertPlaceholders(text, params);
    return pool.query(sql, convertedParams);
  },
  execute: async (text, params) => {
    const { sql, params: convertedParams } = convertPlaceholders(text, params);
    const result = await pool.query(sql, convertedParams);
    return [result.rows, result.fields];
  },
  getConnection: async () => {
    const client = await pool.connect();
    return {
      execute: async (text, params) => {
        const { sql, params: convertedParams } = convertPlaceholders(text, params);
        const result = await client.query(sql, convertedParams);
        return [result.rows, result.fields];
      },
      beginTransaction: async () => {
        await client.query("BEGIN");
      },
      commit: async () => {
        await client.query("COMMIT");
      },
      rollback: async () => {
        await client.query("ROLLBACK");
      },
      release: () => client.release(),
    };
  },
};

// Test database connection and print helpful guidance if it fails
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("PostgreSQL database connection successful");
    client.release();
  } catch (error) {
    console.error("Error connecting to PostgreSQL database:");
    console.error("  Database URL:", process.env.DATABASE_URL || "<not set>");
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

module.exports = dbClient;
