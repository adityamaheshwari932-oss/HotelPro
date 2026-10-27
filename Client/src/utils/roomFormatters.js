/**
 * Formats a room type code into a friendly display title.
 *
 * @param {string} [type]
 * @returns {string}
 */
export const formatRoomType = (type) => {
  if (!type) return 'Standard Room';
  switch (String(type).toLowerCase()) {
    case 'single':
      return 'Single Room';
    case 'double':
      return 'Double Room';
    case 'suite':
      return 'Luxury Suite';
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
};

/**
 * Calculates average nightly rate safely from total price and stay nights.
 *
 * @param {number} totalStayPrice
 * @param {number} nights
 * @returns {number}
 */
export const calculateAverageNightlyRate = (totalStayPrice, nights) => {
  if (!nights || nights <= 0) return 0;
  if (typeof totalStayPrice !== 'number' || isNaN(totalStayPrice)) return 0;
  return Math.round(totalStayPrice / nights);
};

/**
 * Formats monetary amounts consistently with currency symbol.
 *
 * @param {number} amount
 * @param {string} [currency='USD']
 * @returns {string}
 */
export const formatPrice = (amount, currency = 'USD') => {
  if (typeof amount !== 'number' || isNaN(amount)) return '$0';
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${amount.toLocaleString()}`;
};
