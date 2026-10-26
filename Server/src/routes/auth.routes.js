const express = require('express');
const authController = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

// Public authentication routes
router.post('/register', authController.register);
router.post('/login', authController.login);

// Protected routes (require Bearer JWT)
router.get('/me', protect, authController.getMe);

module.exports = router;
