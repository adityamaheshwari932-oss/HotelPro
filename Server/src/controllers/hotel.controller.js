const hotelService = require('../services/hotel.service');

/**
 * Retrieves list of active hotel properties.
 *
 * Route: GET /api/hotels
 * Access: Public / Authenticated
 */
const getHotels = async (req, res, next) => {
  try {
    const hotels = await hotelService.listHotels();

    res.status(200).json({
      success: true,
      data: {
        hotels
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getHotels
};
