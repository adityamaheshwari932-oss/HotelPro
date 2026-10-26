/**
 * HotelPro - Initial Administrator Setup Script
 *
 * Runs a controlled, one-time administrator account creation workflow.
 * Refuses to proceed if an administrator already exists or if concurrent setups are attempted.
 *
 * Usage:
 *   node scripts/init-admin.js --name="Admin Name" --email="admin@hotelpro.com" --password="AdminPassword123!" --secret="YOUR_ADMIN_SETUP_SECRET"
 *
 * Or using environment variables:
 *   INIT_ADMIN_NAME="Admin Name"
 *   INIT_ADMIN_EMAIL="admin@hotelpro.com"
 *   INIT_ADMIN_PASSWORD="AdminPassword123!"
 *   ADMIN_SETUP_SECRET="YOUR_ADMIN_SETUP_SECRET"
 *   node scripts/init-admin.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const { initializeInitialAdmin } = require('../src/services/auth.service');

const parseArgs = () => {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, ...values] = arg.slice(2).split('=');
      args[key] = values.join('=');
    }
  }
  return args;
};

const runInit = async () => {
  const cliArgs = parseArgs();

  const name = cliArgs.name || process.env.INIT_ADMIN_NAME;
  const email = cliArgs.email || process.env.INIT_ADMIN_EMAIL;
  const password = cliArgs.password || process.env.INIT_ADMIN_PASSWORD;
  const phone = cliArgs.phone || process.env.INIT_ADMIN_PHONE || '';
  const setupSecret = cliArgs.secret || process.env.ADMIN_SETUP_SECRET;

  if (!name || !email || !password || !setupSecret) {
    console.error('[HotelPro Setup Error] Missing required parameters.');
    console.error('Provide name, email, password, and setup secret via CLI arguments or environment variables.');
    process.exit(1);
  }

  try {
    console.log('[HotelPro Setup] Connecting to database...');
    await connectDB();

    console.log('[HotelPro Setup] Executing one-time administrator initialization...');
    const admin = await initializeInitialAdmin({
      name,
      email,
      password,
      phone,
      setupSecret
    });

    console.log('[HotelPro Setup] Administrator created successfully!');
    console.log(`[HotelPro Setup] Admin ID:    ${admin.id}`);
    console.log(`[HotelPro Setup] Admin Name:  ${admin.name}`);
    console.log(`[HotelPro Setup] Admin Email: ${admin.email}`);
    console.log(`[HotelPro Setup] Role:        ${admin.role}`);
    console.log('[HotelPro Setup] Setup is now permanently closed.');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error(`[HotelPro Setup Error] Initialization failed: ${error.message}`);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close().catch(() => {});
    }
    process.exit(1);
  }
};

runInit();
