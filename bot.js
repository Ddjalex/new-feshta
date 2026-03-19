/*
 * Telegram Bot (Telegraf) setup.
 *
 * This module supports two modes:
 * - Local development (polling): the bot will use `bot.launch()`.
 * - Serverless deployments (webhook): the bot registers a webhook endpoint and
 *   expects Telegram to send updates to it.
 *
 * In Vercel, we use the webhook mode (it sets `process.env.VERCEL`).
 */

const { Telegraf } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required in environment variables");
}

const WEBAPP_URL = process.env.WEBAPP_URL;

const bot = new Telegraf(BOT_TOKEN);

// Determine default webhook path.
// In Vercel serverless functions, the /api prefix is stripped, so we use /webhook.
// Locally, keep the /api prefix to match local testing routes.
const isVercel = !!process.env.VERCEL;
const defaultWebhookPath = isVercel ? "/webhook" : "/api/webhook";
const webhookPath = process.env.TELEGRAM_WEBHOOK_PATH || defaultWebhookPath;

// Build a webhook URL using the configured WEBAPP_URL (preferred) or Vercel provided URL.
const webhookUrl =
  process.env.TELEGRAM_WEBHOOK_URL ||
  (WEBAPP_URL ? `${WEBAPP_URL.replace(/\/$/, "")}${webhookPath}` : undefined) ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}${webhookPath}` : undefined);

// Basic /start handler (responds with a button that opens the mini-app)
bot.start(async (ctx) => {
  const url = WEBAPP_URL || (VERCEL_URL && `https://${VERCEL_URL}`) || "";

  await ctx.reply(
    "🎉 Welcome to Bingo Game! Click the button below to open the mini app.",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🎮 Open Bingo Mini App",
              web_app: { url },
            },
          ],
        ],
      },
    }
  );
});

bot.help((ctx) => ctx.reply("Send /start to open the Bingo Mini App."));

// Example simple ping reply
bot.command("ping", (ctx) => ctx.reply("pong"));

// Export the bot + webhook helpers so the server can mount them
module.exports = {
  bot,
  webhookPath,
  webhookCallback: bot.webhookCallback(webhookPath),
  async init() {
    // Avoid running initialization multiple times in serverless cold starts
    if (global.__telegramBotInitialized) return;
    global.__telegramBotInitialized = true;

    // If we have a webhook URL, register it. Otherwise, fall back to polling.
    if (webhookUrl) {
      try {
        console.log("Setting Telegram webhook to", webhookUrl);
        await bot.telegram.setWebhook(webhookUrl);
      } catch (err) {
        console.error("Failed to set Telegram webhook:", err);
      }
    } else {
      // Polling is useful for local development (not recommended for serverless)
      try {
        console.log("Starting Telegram bot in polling mode (local dev)");
        await bot.launch();
      } catch (err) {
        console.error("Failed to start Telegram bot (polling):", err);
      }
    }
  },
};
