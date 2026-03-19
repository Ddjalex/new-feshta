require("dotenv").config({ override: true });
const { Pool } = require("pg");

// Build Neon-compatible connection string with endpoint fallback
function normalizeNeonHost(hostname) {
  if (!hostname) return hostname;

  // Neon pooler hostnames can be in the form <id>.c6.us-east-1.aws.neon.tech,
  // but TLS certs use *.us-east-1.aws.neon.tech. Normalize to host that matches certificate.
  if (hostname.includes(".c6.") && hostname.endsWith(".aws.neon.tech")) {
    return hostname.replace(".c6.", ".");
  }

  if (hostname.endsWith(".aws.neon.tech")) {
    // already in cert scope, no change
    return hostname;
  }

  return hostname;
}

function ensureNeonConnectionString(urlString) {
  if (!urlString) return urlString;

  try {
    const url = new URL(urlString);

    // If Neon, normalize hostname and include endpoint option in URL query when missing
    if (url.hostname && url.hostname.endsWith(".neon.tech")) {
      const normalized = normalizeNeonHost(url.hostname);
      if (normalized && normalized !== url.hostname) {
        url.hostname = normalized;
      }

      const currentOptions = url.searchParams.get("options");
      if (!currentOptions || !currentOptions.includes("endpoint")) {
        const endpointId = url.hostname.split(".")[0];
        if (endpointId) {
          url.searchParams.set("options", `endpoint=${encodeURIComponent(endpointId)}`);
        }
      }

      // Use libpq compatibility; avoid pg default behavior changing in future versions
      if (!url.searchParams.has("uselibpqcompat")) {
        url.searchParams.set("uselibpqcompat", "true");
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
      ssl: {
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
      },
    }
  : {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: {
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
      }, // Neon requires SSL
    };

const pool = new Pool(poolConfig);
let dbAvailable = true;

function wrapQuery(fn) {
  return async (text, params = []) => {
    if (!dbAvailable) {
      console.warn('Database unavailable, returning empty result for query:', text);
      return { rows: [], fields: [] };
    }

    try {
      const { sql, params: convertedParams } = convertPlaceholders(text, params);
      return await fn(sql, convertedParams);
    } catch (error) {
      console.error('Database query failed, marking DB as unavailable:', error.message || error);
      dbAvailable = false;
      return { rows: [], fields: [] };
    }
  };
}

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
  query: async (text, params) => {
    if (!dbAvailable) {
      console.warn('Database unavailable: query fallback to empty');
      return { rows: [], fields: [] };
    }

    try {
      const { sql, params: convertedParams } = convertPlaceholders(text, params);
      return await pool.query(sql, convertedParams);
    } catch (error) {
      console.error('Database query failed, marking DB as unavailable:', error.message || error);
      dbAvailable = false;
      return { rows: [], fields: [] };
    }
  },

  execute: async (text, params) => {
    if (!dbAvailable) {
      console.warn('Database unavailable: execute fallback to empty rows');
      return [[], []];
    }

    try {
      const { sql, params: convertedParams } = convertPlaceholders(text, params);
      const result = await pool.query(sql, convertedParams);
      return [result.rows, result.fields || []];
    } catch (error) {
      console.error('Database execute failed, marking DB as unavailable:', error.message || error);
      dbAvailable = false;
      return [[], []];
    }
  },

  getConnection: async () => {
    if (!dbAvailable) {
      throw new Error('Database not available during getConnection');
    }

    const client = await pool.connect();
    return {
      execute: async (text, params) => {
        try {
          const { sql, params: convertedParams } = convertPlaceholders(text, params);
          const result = await client.query(sql, convertedParams);
          return [result.rows, result.fields || []];
        } catch (error) {
          console.error('Connection execute failed:', error.message || error);
          throw error;
        }
      },
      beginTransaction: async () => {
        await client.query('BEGIN');
      },
      commit: async () => {
        await client.query('COMMIT');
      },
      rollback: async () => {
        await client.query('ROLLBACK');
      },
      release: () => client.release(),
    };
  },

  isAvailable: () => dbAvailable,
};

// Test database connection and print helpful guidance if it fails
async function ensureUserTableColumns() {
  try {
    const client = await pool.connect();

    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS isblocked BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS blocked_reason TEXT
    `);

    client.release();
  } catch (error) {
    console.warn("Could not ensure users table columns; continuing anyway:", error.message || error);
  }
}

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("PostgreSQL database connection successful");

    // Ensure schema fields expected by the app exist
    await ensureUserTableColumns();

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
