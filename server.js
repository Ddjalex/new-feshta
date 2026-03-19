const express = require("express");
const path = require("path");
const cors = require("cors");

// Load environment variables
require("dotenv").config();

// Create Express app
const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Telegram bot (webhook/polling) setup
const telegramBot = require("./bot");

// Telegram webhook endpoint (used on Vercel)
// Use `app.post()` so the Telegraf middleware sees the full request path.
app.post(telegramBot.webhookPath, telegramBot.webhookCallback);

// API routes (mounted under /api)
const telegramRoutes = require("./routes/telegramRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const apiRoutes = require("./routes/index");

app.use("/api/telegram", telegramRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api", apiRoutes);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Handle all other routes and redirect to index.html (for SPA)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Initialize Telegram bot (either webhook mode or polling mode)
telegramBot.init().catch((err) => {
  console.error("Failed to initialize Telegram bot:", err);
});

// For local development / direct node runs, start the HTTP server.
// In serverless environments (e.g. Vercel), the handler is exported and Vercel will invoke it.
if (require.main === module) {
  const PORT = process.env.WEBAPP_PORT || process.env.PORT || 3002;
  app.listen(PORT, () => {
    console.log(`Mini App server running on port ${PORT}`);
  });
}

module.exports = app;
