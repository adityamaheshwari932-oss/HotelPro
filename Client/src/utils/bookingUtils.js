import { validateSearchParams } from './roomSearchValidation.js';

/**
 * Calculates remaining time until a booking hold expires.
 *
 * SAFETY GUARANTEES:
 * 1. Computes remaining time directly from the backend's authoritative `holdExpiresAt` timestamp.
 * 2. Never restarts or invents a 15-minute countdown on page render or component mount.
 * 3. Safely handles missing, null, or malformed timestamps without crashing.
 * 4. Correctly flags expired state when the current time reaches or exceeds the hold deadline.
 *
 * @param {string | Date | null | undefined} holdExpiresAt - Authoritative hold deadline from server
 * @param {Date | number} [now=new Date()] - Reference time for evaluation
 * @returns {{
 *   hasHold: boolean,
 *   expired: boolean,
 *   totalSeconds: number,
 *   minutes: number,
 *   seconds: number,
 *   formatted: string
 * }}
 */
export const calculateRemainingHoldTime = (holdExpiresAt, now = new Date()) => {
  if (!holdExpiresAt) {
    return {
      hasHold: false,
      expired: false,
      totalSeconds: 0,
      minutes: 0,
      seconds: 0,
      formatted: '--:--'
    };
  }

  const deadlineMs = new Date(holdExpiresAt).getTime();
  if (isNaN(deadlineMs)) {
    return {
      hasHold: false,
      expired: false,
      totalSeconds: 0,
      minutes: 0,
      seconds: 0,
      formatted: '--:--'
    };
  }

  const nowMs = typeof now === 'number' ? now : (now instanceof Date && !isNaN(now.getTime()) ? now.getTime() : Date.now());
  const diffMs = deadlineMs - nowMs;

  if (diffMs <= 0) {
    return {
      hasHold: true,
      expired: true,
      totalSeconds: 0,
      minutes: 0,
      seconds: 0,
      formatted: '00:00'
    };
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return {
    hasHold: true,
    expired: false,
    totalSeconds,
    minutes,
    seconds,
    formatted
  };
};

/**
 * Validates booking creation form fields before sending request to POST /api/bookings.
 *
 * Enforces backend validator rules:
 * - checkInDate & checkOutDate: valid ISO dates, checkOut > checkIn, stay <= 180 days
 * - guestCount: integer >= 1, and <= roomCapacity when capacity is known
 * - guestInfo.name: non-empty string, length >= 2
 * - guestInfo.email: valid email format
 * - guestInfo.phone: optional string
 *
 * @param {object} formValues
 * @param {number} [roomCapacity]
 * @returns {{ isValid: boolean, errors: Record<string, string> }}
 */
export const validateBookingForm = (formValues = {}, roomCapacity = null) => {
  const errors = {};

  // 1. Validate dates
  const dateResult = validateSearchParams({
    checkInDate: formValues.checkInDate,
    checkOutDate: formValues.checkOutDate
  });

  if (!dateResult.isValid) {
    if (dateResult.errors.checkInDate) errors.checkInDate = dateResult.errors.checkInDate;
    if (dateResult.errors.checkOutDate) errors.checkOutDate = dateResult.errors.checkOutDate;
  }

  // 2. Validate guest count
  if (formValues.guestCount === undefined || formValues.guestCount === null || formValues.guestCount === '') {
    errors.guestCount = 'Guest count is required.';
  } else {
    const parsedGuests = parseInt(formValues.guestCount, 10);
    if (isNaN(parsedGuests) || parsedGuests < 1) {
      errors.guestCount = 'Guest count must be at least 1 guest.';
    } else if (roomCapacity !== null && typeof roomCapacity === 'number' && parsedGuests > roomCapacity) {
      errors.guestCount = `Guest count (${parsedGuests}) exceeds room capacity (${roomCapacity}).`;
    }
  }

  // 3. Validate guest details
  const nameTrimmed = (formValues.name || '').trim();
  if (!nameTrimmed) {
    errors.name = 'Guest full name is required.';
  } else if (nameTrimmed.length < 2) {
    errors.name = 'Guest name must be at least 2 characters.';
  }

  const emailTrimmed = (formValues.email || '').trim();
  if (!emailTrimmed) {
    errors.email = 'Guest email address is required.';
  } else if (!/^\S+@\S+\.\S+$/.test(emailTrimmed)) {
    errors.email = 'Please provide a valid email address.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

/**
 * Formats a booking status code into a readable title and styling badge type.
 *
 * @param {string} status
 * @param {boolean} [isHoldExpired=false]
 * @returns {{ label: string, variant: string }}
 */
export const formatBookingStatus = (status, isHoldExpired = false) => {
  switch (String(status).toLowerCase()) {
    case 'pending':
      if (isHoldExpired) {
        return { label: 'Hold Expired', variant: 'status-danger' };
      }
      return { label: 'Hold Reserved (Pending)', variant: 'status-warning' };
    case 'confirmed':
      return { label: 'Confirmed', variant: 'status-success' };
    case 'checked_in':
      return { label: 'Checked In', variant: 'status-info' };
    case 'checked_out':
      return { label: 'Checked Out', variant: 'status-neutral' };
    case 'cancelled':
      return { label: 'Cancelled', variant: 'status-danger' };
    default:
      return { label: status || 'Unknown', variant: 'status-neutral' };
  }
};

/**
 * Formats an ISO date string for display (e.g. '2026-11-01' -> 'Nov 1, 2026').
 *
 * @param {string | Date} dateInput
 * @returns {string}
 */
export const formatDateDisplay = (dateInput) => {
  if (!dateInput) return '';
  const dateObj = typeof dateInput === 'string' && dateInput.length === 10
    ? new Date(`${dateInput}T00:00:00Z`)
    : new Date(dateInput);

  if (isNaN(dateObj.getTime())) return String(dateInput);

  return dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
};

/**
 * Formats a payment status code into a human-readable title and styling badge type.
 *
 * @param {string} status
 * @returns {{ label: string, variant: string }}
 */
export const formatPaymentStatus = (status) => {
  switch (String(status).toLowerCase()) {
    case 'pending':
      return { label: 'Pending Payment', variant: 'status-warning' };
    case 'completed':
      return { label: 'Paid & Completed', variant: 'status-success' };
    case 'failed':
      return { label: 'Payment Failed', variant: 'status-danger' };
    case 'refunded':
      return { label: 'Refunded', variant: 'status-info' };
    case 'partially_refunded':
      return { label: 'Partially Refunded', variant: 'status-info' };
    default:
      return { label: status ? String(status).toUpperCase() : 'Not Paid', variant: 'status-neutral' };
  }
};

/**
 * Formats a monetary amount and currency code safely.
 *
 * @param {number | string} amount
 * @param {string} [currency='USD']
 * @returns {string}
 */
export const formatCurrency = (amount, currency = 'USD') => {
  const num = typeof amount === 'number' ? amount : parseFloat(amount);
  if (isNaN(num)) return `$0.00 ${currency}`;
  return `$${num.toFixed(2)} ${currency.toUpperCase()}`;
};

/**
 * Formats a raw MongoDB ObjectId or booking ID into an aesthetic booking reference code.
 * e.g., '60c72b2f9b1d8b2bad000001' -> 'HP-AD000001'
 *
 * @param {string} bookingId
 * @returns {string}
 */
export const formatBookingReference = (bookingId) => {
  if (!bookingId) return 'HP-UNKNOWN';
  const clean = String(bookingId).trim();
  if (clean.length >= 8) {
    return `HP-${clean.slice(-8).toUpperCase()}`;
  }
  return `HP-${clean.toUpperCase()}`;
};


