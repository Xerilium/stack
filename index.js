// Stack - Simple, multi-project task management and prioritization
// Using @xerilium/catalyst framework

const path = require('path');
const fs = require('fs');

// Verify @xerilium/catalyst is installed
const catalystPath = path.join(__dirname, 'node_modules', '@xerilium', 'catalyst');

if (fs.existsSync(catalystPath)) {
  console.log('✓ @xerilium/catalyst is installed');
  console.log(`  Location: ${catalystPath}`);
  
  // Read package info
  const packageJson = require('@xerilium/catalyst/package.json');
  console.log(`  Version: ${packageJson.version}`);
  console.log(`  Description: ${packageJson.description}`);
} else {
  console.log('✗ @xerilium/catalyst is not installed');
  process.exit(1);
}

module.exports = {};
