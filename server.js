const express = require("express");
const path = require("path");
const cors = require("cors");
const fileUpload = require("express-fileupload");

// Load environment variables
require("dotenv").config();

// Create Express app
const app = express();

// Configure CORS
app.use(cors());

// Configure file upload middleware
app.use(
  fileUpload({
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    abortOnLimit: true,
    createParentPath: true,
  })
);

// Parse JSON bodies
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Import and use telegram routes
const telegramRoutes = require("./routes/telegramRoutes");
app.use("/api/telegram", telegramRoutes);

// Handle all routes and redirect to index.html (for SPA)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mini App server running on port ${PORT}`);
});
