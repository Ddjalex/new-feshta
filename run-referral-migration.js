// Script to run the referral system migration
require("dotenv").config();
const { exec } = require("child_process");

console.log("Starting referral system migration...");

// Use a direct path to avoid issues with spaces in paths
const migrationPath = "./migrations/add-referral-system.js";

// Execute the migration script
exec(`node "${migrationPath}"`, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error executing migration: ${error.message}`);
    return;
  }

  if (stderr) {
    console.error(`Migration errors: ${stderr}`);
    return;
  }

  console.log(stdout);
  console.log("Referral system migration completed successfully!");
});
