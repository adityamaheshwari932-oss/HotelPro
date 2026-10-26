// Load environment variables before importing dependent modules
require('dotenv').config();

const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./src/config/db');

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

let server = null;
let isShuttingDown = false;

/**
 * Performs graceful shutdown of HTTP server and database connections.
 *
 * @param {string} signal - The termination signal received
 */
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[HotelPro Server] Received ${signal}. Starting graceful shutdown...`);

  const shutdownTimeout = setTimeout(() => {
    console.error('[HotelPro Server] Graceful shutdown timed out. Forcing process exit.');
    process.exit(1);
  }, 10000);

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      console.log('[HotelPro Server] HTTP server closed. No longer accepting requests.');
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
      console.log('[HotelPro Server] MongoDB connection closed.');
    }

    clearTimeout(shutdownTimeout);
    console.log('[HotelPro Server] Graceful shutdown completed.');
    process.exit(0);
  } catch (error) {
    clearTimeout(shutdownTimeout);
    console.error(`[HotelPro Server] Error during shutdown: ${error.message}`);
    process.exit(1);
  }
};

// Register signal handlers once
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

/**
 * Initializes database connection and starts HTTP server listener.
 */
const startServer = async () => {
  try {
    // Connect to database before listening for incoming HTTP requests
    await connectDB();

    server = app.listen(PORT, () => {
      console.log(`[HotelPro Server] Server running in ${NODE_ENV} mode on port ${PORT}`);
      console.log(`[HotelPro Server] Liveness endpoint:  http://localhost:${PORT}/api/health`);
      console.log(`[HotelPro Server] Readiness endpoint: http://localhost:${PORT}/api/health/ready`);
    });

    server.on('error', (err) => {
      console.error(`[HotelPro Server] Server network error: ${err.message}`);
      process.exit(1);
    });

    return server;
  } catch (error) {
    console.error(`[HotelPro Server] Failed to initialize server: ${error.message}`);
    process.exit(1);
  }
};

startServer();

module.exports = { app, startServer };
