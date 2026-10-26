const { AppError } = require('../middleware/error.middleware');

/**
 * Generates an array of date strings in 'YYYY-MM-DD' format for each night of a stay.
 * The stay covers checkInDate (inclusive) up to checkOutDate (exclusive).
 *
 * Uses UTC date calculations to avoid timezone shifts or DST off-by-one errors.
 *
 * @param {string} checkInStr - 'YYYY-MM-DD'
 * @param {string} checkOutStr - 'YYYY-MM-DD'
 * @returns {string[]} Array of date strings for each night
 */
const getStayDatesInRange = (checkInStr, checkOutStr) => {
  const dates = [];
  const [inYear, inMonth, inDay] = checkInStr.split('-').map(Number);
  const [outYear, outMonth, outDay] = checkOutStr.split('-').map(Number);

  const current = new Date(Date.UTC(inYear, inMonth - 1, inDay));
  const end = new Date(Date.UTC(outYear, outMonth - 1, outDay));

  while (current < end) {
    const year = current.getUTCFullYear();
    const month = String(current.getUTCMonth() + 1).padStart(2, '0');
    const day = String(current.getUTCDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
};

/**
 * Calculates date-specific nightly breakdown and total stay price for a room.
 *
 * PRICING SEMANTICS & PRECEDENCE:
 * - Each night from checkIn (inclusive) to checkOut (exclusive) is priced individually.
 * - For each night, pricing rules are evaluated against interval [startDate, endDate).
 * - Precedence: The first rule in room.pricingRules that covers the night is applied.
 * - Fallback: If no rule covers the night, room.basePrice is applied.
 * - Validation: Nightly rates and total stay price must be finite, non-negative numbers.
 * - Transparency: Returns an exact nightly breakdown. Taxes and fees are not fabricated.
 *
 * @param {object} room - Room document or object with basePrice and optional pricingRules
 * @param {string} checkInStr - 'YYYY-MM-DD'
 * @param {string} checkOutStr - 'YYYY-MM-DD'
 * @returns {object} { nights, baseNightlyPrice, nightlyBreakdown, totalRoomPrice, currency }
 */
const calculateStayPrice = (room, checkInStr, checkOutStr) => {
  if (!room || typeof room.basePrice !== 'number' || room.basePrice < 0) {
    throw new AppError('Invalid room data: valid basePrice is required for pricing calculation', 500);
  }

  const stayDates = getStayDatesInRange(checkInStr, checkOutStr);
  if (stayDates.length === 0) {
    throw new AppError('Stay must be at least 1 night (checkout must be after check-in)', 400);
  }

  const rules = Array.isArray(room.pricingRules) ? room.pricingRules : [];

  const nightlyBreakdown = stayDates.map((dateStr) => {
    // Deterministic rule evaluation: first rule covering the night [startDate, endDate)
    const matchingRule = rules.find(
      (rule) =>
        rule &&
        typeof rule.startDate === 'string' &&
        typeof rule.endDate === 'string' &&
        typeof rule.price === 'number' &&
        dateStr >= rule.startDate &&
        dateStr < rule.endDate
    );

    const rate = matchingRule ? matchingRule.price : room.basePrice;

    if (!Number.isFinite(rate) || rate < 0) {
      throw new AppError(`Calculated invalid rate for stay night ${dateStr}`, 500);
    }

    return {
      date: dateStr,
      rate,
      ruleApplied: matchingRule ? (matchingRule.ruleName || 'Date Rule') : null
    };
  });

  const totalRoomPrice = nightlyBreakdown.reduce((sum, item) => sum + item.rate, 0);

  if (!Number.isFinite(totalRoomPrice) || totalRoomPrice < 0) {
    throw new AppError('Calculated invalid total stay price', 500);
  }

  return {
    nights: nightlyBreakdown.length,
    baseNightlyPrice: room.basePrice,
    nightlyBreakdown,
    totalRoomPrice,
    currency: 'USD'
  };
};

module.exports = {
  getStayDatesInRange,
  calculateStayPrice
};
