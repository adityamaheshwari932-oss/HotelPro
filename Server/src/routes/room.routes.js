const express = require('express');
const roomController = require('../controllers/room.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

// Public routes
// Note: '/search' and '/admin' must be defined before '/:id' to avoid routing conflicts
router.get('/search', roomController.searchRooms);

// Admin listing endpoint - must be before /:id
router.get('/admin', protect, restrictTo('admin'), roomController.listAdminRooms);

router.get('/', roomController.listRooms);
router.get('/:id', roomController.getRoomById);

// Admin-only management routes
router.post('/', protect, restrictTo('admin'), roomController.createRoom);
router.patch('/:id', protect, restrictTo('admin'), roomController.updateRoom);
router.patch('/:id/status', protect, restrictTo('admin'), roomController.updateRoomStatus);

module.exports = router;
