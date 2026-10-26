const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

// CORS configuration
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
app.use(cors({
  origin: clientUrl,
  credentials: true
}));

// Request body parsing middleware
app.use(express.json());

// Basic liveness health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'HotelPro API is running smoothly',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Readiness health check endpoint (checks MongoDB connection state)
app.get('/api/health/ready', (req, res) => {
  // readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  const isDbConnected = mongoose.connection.readyState === 1;

  if (isDbConnected) {
    return res.status(200).json({
      success: true,
      status: 'ready',
      message: 'HotelPro API is ready to accept traffic',
      database: 'connected'
    });
  }

  return res.status(503).json({
    success: false,
    status: 'not_ready',
    message: 'HotelPro API is not ready: database is unavailable',
    database: 'disconnected'
  });
});

// Application routes
const authRoutes = require('./src/routes/auth.routes');
const roomRoutes = require('./src/routes/room.routes');
const bookingRoutes = require('./src/routes/booking.routes');
const { notFoundHandler, errorHandler } = require('./src/middleware/error.middleware');

app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/bookings', bookingRoutes);

// 404 catch-all handler for unknown endpoints
app.use(notFoundHandler);

// Central JSON error handler
app.use(errorHandler);

module.exports = app;
