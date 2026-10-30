const Hotel = require('../models/hotel.model');

/**
 * Lists active hotel properties for hotel selection.
 *
 * @returns {Promise<Array>}
 */
const listHotels = async () => {
  return await Hotel.find({ status: 'active', isActive: { $ne: false } })
    .select('_id name description address contact status')
    .sort({ name: 1 })
    .lean();
};

module.exports = {
  listHotels
};
