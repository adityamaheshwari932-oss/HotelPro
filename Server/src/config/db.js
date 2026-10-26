const mongoose = require('mongoose');

/**
 * Connects to MongoDB using Mongoose and the MONGODB_URI environment variable.
 * Logs connection metadata (database name and host) without exposing credentials.
 * Re-throws connection errors so the application cannot mistakenly continue as connected.
 *
 * @returns {Promise<typeof mongoose>}
 */
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    const error = new Error('MONGODB_URI environment variable is not defined.');
    console.error(`[Database Error] ${error.message}`);
    throw error;
  }

  try {
    const conn = await mongoose.connect(uri);
    const host = conn.connection.host || 'unknown-host';
    const dbName = conn.connection.name || 'unknown-db';

    console.log(`[Database] MongoDB connected successfully to database "${dbName}" on host ${host}`);
    return conn;
  } catch (error) {
    console.error(`[Database Error] Failed to connect to MongoDB: ${error.message}`);
    throw error;
  }
};

module.exports = connectDB;
