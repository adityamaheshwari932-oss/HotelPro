/**
 * Helper to get ISO date string (YYYY-MM-DD) for today.
 */
export const getTodayIso = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Helper to get ISO date string for tomorrow.
 */
export const getTomorrowIso = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Validates search criteria against backend expectations.
 *
 * Constraints verified against Server/src/validators/room.validator.js:
 * - checkInDate: required, ISO format YYYY-MM-DD
 * - checkOutDate: required, ISO format YYYY-MM-DD, strictly after checkInDate, stay <= 180 days
 * - guests (capacity): optional, positive integer >= 1
 * - roomType: optional, enum ['single', 'double', 'suite']
 * - minPrice, maxPrice: optional, non-negative numbers, minPrice <= maxPrice
 *
 * @param {object} values
 * @returns {{ isValid: boolean, errors: Record<string, string> }}
 */
export const validateSearchParams = (values) => {
  const errors = {};

  if (!values.checkInDate) {
    errors.checkInDate = 'Check-in date is required.';
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.checkInDate)) {
    errors.checkInDate = 'Check-in date must be formatted as YYYY-MM-DD.';
  }

  if (!values.checkOutDate) {
    errors.checkOutDate = 'Check-out date is required.';
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.checkOutDate)) {
    errors.checkOutDate = 'Check-out date must be formatted as YYYY-MM-DD.';
  }

  if (values.checkInDate && values.checkOutDate) {
    if (values.checkOutDate <= values.checkInDate) {
      errors.checkOutDate = 'Check-out date must be strictly after check-in date.';
    } else {
      const inD = new Date(`${values.checkInDate}T00:00:00Z`);
      const outD = new Date(`${values.checkOutDate}T00:00:00Z`);
      const diffDays = Math.round((outD - inD) / (1000 * 60 * 60 * 24));
      if (diffDays > 180) {
        errors.checkOutDate = 'Stay duration cannot exceed 180 days.';
      }
    }
  }

  if (values.guests !== undefined && values.guests !== '') {
    const guestsNum = parseInt(values.guests, 10);
    if (isNaN(guestsNum) || guestsNum < 1) {
      errors.guests = 'Guest count must be at least 1.';
    }
  }

  if (values.roomType && !['single', 'double', 'suite'].includes(values.roomType)) {
    errors.roomType = 'Room type must be single, double, or suite.';
  }

  const minP = values.minPrice !== undefined && values.minPrice !== '' ? parseFloat(values.minPrice) : null;
  const maxP = values.maxPrice !== undefined && values.maxPrice !== '' ? parseFloat(values.maxPrice) : null;

  if (minP !== null && (isNaN(minP) || minP < 0)) {
    errors.minPrice = 'Minimum price must be a non-negative number.';
  }

  if (maxP !== null && (isNaN(maxP) || maxP < 0)) {
    errors.maxPrice = 'Maximum price must be a non-negative number.';
  }

  if (minP !== null && maxP !== null && minP > maxP) {
    errors.minPrice = 'Minimum price cannot exceed maximum price.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

/**
 * Builds backend-compliant query parameter object for GET /api/rooms/search.
 *
 * Maps user filters to confirmed backend names:
 * - guests -> capacity
 * - checkInDate, checkOutDate
 * - roomType, minPrice, maxPrice
 *
 * @param {object} filters
 * @returns {Record<string, string | number>}
 */
export const buildRoomSearchParams = (filters = {}) => {
  const queryParams = {};

  if (filters.checkInDate) {
    queryParams.checkInDate = filters.checkInDate;
  }
  if (filters.checkOutDate) {
    queryParams.checkOutDate = filters.checkOutDate;
  }

  if (filters.guests !== undefined && filters.guests !== '') {
    const parsedGuests = parseInt(filters.guests, 10);
    if (!isNaN(parsedGuests) && parsedGuests >= 1) {
      queryParams.capacity = parsedGuests;
    }
  }

  if (filters.roomType) {
    queryParams.roomType = filters.roomType;
  }

  if (filters.minPrice !== undefined && filters.minPrice !== '') {
    const parsedMin = parseFloat(filters.minPrice);
    if (!isNaN(parsedMin) && parsedMin >= 0) {
      queryParams.minPrice = parsedMin;
    }
  }

  if (filters.maxPrice !== undefined && filters.maxPrice !== '') {
    const parsedMax = parseFloat(filters.maxPrice);
    if (!isNaN(parsedMax) && parsedMax >= 0) {
      queryParams.maxPrice = parsedMax;
    }
  }

  return queryParams;
};
