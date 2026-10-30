const express = require('express');
const userController = require('../controllers/user.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

// Admin-only user management routes
router.get('/', protect, restrictTo('admin'), userController.listUsers);

module.exports = router;
