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
    console.log("Creating bot_texts table (for dynamic bot messages)...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_texts (
        id SERIAL PRIMARY KEY,
        key VARCHAR(50) UNIQUE NOT NULL,
        content TEXT NOT NULL
      )
    `);

    // Insert default texts if not present
    const defaults = [
      { key: 'winning_patterns', content: '🏆 Winning Patterns:\n1. Full Row\n2. Full Column\n3. Diagonal\n...' },
      { key: 'instructions', content: '📝 Game Instructions:\n- How to play...\n- Rules...' },
      { key: 'contact_support', content: '☎️ Contact Support:\nEmail: support@yourdomain.com\nTelegram: @your_support' }
    ];
    for (const entry of defaults) {
      await pool.query(
        `INSERT INTO bot_texts (key, content) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [entry.key, entry.content]
      );
    }

    console.log("bot_texts table created and default messages inserted.");
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