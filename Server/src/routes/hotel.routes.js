const express = require('express');
const hotelController = require('../controllers/hotel.controller');

const router = express.Router();

router.get('/', hotelController.getHotels);

module.exports = router;
