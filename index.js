/**
 * Entry point used by Vercel (serverless) and local development.
 *
 * When deployed on Vercel, the platform imports this file as a Node.js Serverless Function.
 * In that scenario, we export the Express app so Vercel can route requests through it.
 */

const app = require("./server");

module.exports = app;
