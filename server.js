const express = require("express");
const path = require("path");
const cors = require("cors");

// Load environment variables
require("dotenv").config();

// Create Express app
const app = express();

// Configure CORS
app.use(cors());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Handle all routes and redirect to index.html (for SPA)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start the server
const PORT = process.env.WEBAPP_PORT || 3002;
app.listen(PORT, () => {
  console.log(`Mini App server running on port ${PORT}`);
});
