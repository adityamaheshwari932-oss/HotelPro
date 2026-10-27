import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import {
  getBookingById,
  getBookingPayment,
  createCheckoutSession
} from '../api/paymentApi';
import { ApiError } from '../api/client';
import { formatRoomType } from '../utils/roomFormatters';
import {
  calculateRemainingHoldTime,
  formatBookingStatus,
  formatDateDisplay,
  formatCurrency
} from '../utils/bookingUtils';
import {
  PaymentStatusBadge,
  PaymentSummary,
  MockCheckoutForm,
  StripeCheckoutForm,
  PaymentReconciliationNotice
} from '../components/payment';

export const BookingHoldPage = () => {
  const { id } = useParams();
  const location = useLocation();
  const isNewBooking = location.state?.newBooking || false;

  // Authoritative data state
  const [booking, setBooking] = useState(null);
  const [payment, setPayment] = useState(null);
  const [checkoutSession, setCheckoutSession] = useState(null);

  // Loading and error state
  const [isLoading, setIsLoading] = useState(true);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [errorStatus, setErrorStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [sessionError, setSessionError] = useState('');

  // Live hold countdown state
  const [holdTimer, setHoldTimer] = useState({
    hasHold: false,
    expired: false,
    totalSeconds: 0,
    minutes: 0,
    seconds: 0,
    formatted: '--:--'
  });

  const isMountedRef = useRef(true);

  /**
   * Safe Checkout Session Initializer
   * Creates or safely reuses a backend checkout session.
   */
  const initCheckoutSession = useCallback(async (bookingId) => {
    setIsSessionLoading(true);
    setSessionError('');

    try {
      const sessionRes = await createCheckoutSession({ bookingId });
      if (isMountedRef.current) {
        const sessionData = sessionRes?.data?.checkoutSession;
        setCheckoutSession(sessionData || null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        if (err instanceof ApiError) {
          setSessionError(err.message || 'Failed to initialize payment session.');
        } else {
          setSessionError('Network error connecting to payment gateway.');
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsSessionLoading(false);
      }
    }
  }, []);

  // 1. Fetch Authoritative Booking & Payment Status
  const fetchBookingAndPayment = useCallback(
    async (showMainSpinner = false) => {
      if (!id) return;
      if (showMainSpinner) {
        setIsLoading(true);
      }

      try {
        const [bookingRes, paymentRes] = await Promise.allSettled([
          getBookingById(id),
          getBookingPayment(id)
        ]);

        if (!isMountedRef.current) return;

        // Process Booking Response
        if (bookingRes.status === 'fulfilled') {
          const bookingData = bookingRes.value?.data?.booking;
          if (!bookingData) {
            setErrorStatus(404);
            setErrorMessage('Reservation not found.');
            setIsLoading(false);
            return;
          }
          setBooking(bookingData);
          setHoldTimer(calculateRemainingHoldTime(bookingData.holdExpiresAt));
        } else {
          const err = bookingRes.reason;
          if (err instanceof ApiError) {
            setErrorStatus(err.status);
            setErrorMessage(err.message || 'Unable to retrieve reservation details.');
          } else {
            setErrorStatus(500);
            setErrorMessage('Unable to connect to reservation service. Please check your connection.');
          }
          setIsLoading(false);
          return;
        }

        // Process Payment Response (optional for new bookings)
        let existingPayment = null;
        let hasActivePending = false;
        if (paymentRes.status === 'fulfilled') {
          const pData = paymentRes.value?.data;
          existingPayment = pData?.payment || null;
          hasActivePending = !!pData?.hasActivePendingSession;
          setPayment(existingPayment);
        }

        const bData = bookingRes.value?.data?.booking;
        const currentHold = calculateRemainingHoldTime(bData?.holdExpiresAt);

        // Auto-initialize / recover checkout session if eligible:
        // - Booking status must be 'pending'
        // - Hold must be active
        // - No terminal failed payment waiting for explicit user retry
        const isLastPaymentFailed = existingPayment?.status === 'failed';

        if (bData?.status === 'pending' && !currentHold.expired && (!existingPayment || hasActivePending || !isLastPaymentFailed)) {
          // Initialize checkout session asynchronously
          initCheckoutSession(id);
        }

        setIsLoading(false);
      } catch (err) {
        if (!isMountedRef.current) return;
        setIsLoading(false);
        if (err instanceof ApiError) {
          setErrorStatus(err.status);
          setErrorMessage(err.message || 'Unable to retrieve reservation.');
        } else {
          setErrorStatus(500);
          setErrorMessage('Unable to connect to server. Please try again later.');
        }
      }
    },
    [id, initCheckoutSession]
  );

  useEffect(() => {
    isMountedRef.current = true;
    let isCancelled = false;

    const loadInitial = async () => {
      try {
        const [bookingRes, paymentRes] = await Promise.allSettled([
          getBookingById(id),
          getBookingPayment(id)
        ]);

        if (isCancelled || !isMountedRef.current) return;

        if (bookingRes.status === 'fulfilled') {
          const bookingData = bookingRes.value?.data?.booking;
          if (!bookingData) {
            setErrorStatus(404);
            setErrorMessage('Reservation not found.');
            setIsLoading(false);
            return;
          }
          setBooking(bookingData);
          setHoldTimer(calculateRemainingHoldTime(bookingData.holdExpiresAt));

          let existingPayment = null;
          let hasActivePending = false;
          if (paymentRes.status === 'fulfilled') {
            const pData = paymentRes.value?.data;
            existingPayment = pData?.payment || null;
            hasActivePending = !!pData?.hasActivePendingSession;
            setPayment(existingPayment);
          }

          const currentHold = calculateRemainingHoldTime(bookingData.holdExpiresAt);
          const isLastPaymentFailed = existingPayment?.status === 'failed';

          if (
            bookingData.status === 'pending' &&
            !currentHold.expired &&
            (!existingPayment || hasActivePending || !isLastPaymentFailed)
          ) {
            initCheckoutSession(id);
          }
          setIsLoading(false);
        } else {
          const err = bookingRes.reason;
          if (err instanceof ApiError) {
            setErrorStatus(err.status);
            setErrorMessage(err.message || 'Unable to retrieve reservation details.');
          } else {
            setErrorStatus(500);
            setErrorMessage('Unable to connect to reservation service. Please check your connection.');
          }
          setIsLoading(false);
        }
      } catch (err) {
        if (!isCancelled && isMountedRef.current) {
          setIsLoading(false);
          if (err instanceof ApiError) {
            setErrorStatus(err.status);
            setErrorMessage(err.message || 'Unable to retrieve reservation.');
          } else {
            setErrorStatus(500);
            setErrorMessage('Unable to connect to server. Please try again later.');
          }
        }
      }
    };

    if (id) {
      loadInitial();
    }

    return () => {
      isCancelled = true;
      isMountedRef.current = false;
    };
  }, [id, initCheckoutSession]);



  // 2. Reservation Hold Countdown Timer
  // Recalculates dynamically every second against authoritative `booking.holdExpiresAt`
  useEffect(() => {
    if (!booking?.holdExpiresAt) return;
    if (booking.status !== 'pending') return;

    // Check if already expired before starting interval
    const initialCheck = calculateRemainingHoldTime(booking.holdExpiresAt);
    if (initialCheck.expired) return;

    const intervalId = setInterval(() => {
      const updated = calculateRemainingHoldTime(booking.holdExpiresAt);
      setHoldTimer(updated);

      if (updated.expired) {
        clearInterval(intervalId);
        // Refresh authoritative booking & payment status on hold expiry
        fetchBookingAndPayment(false);
      }
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [booking?.holdExpiresAt, booking?.status, fetchBookingAndPayment]);

  /**
   * Handles Mock Simulation Completion callback
   */
  const handleSimulationComplete = async (outcomeData) => {
    // If simulation reported an immediate outcome, update UI and sync with backend
    if (outcomeData?.status) {
      setPayment((prev) => ({
        ...prev,
        _id: outcomeData.paymentId || prev?._id,
        transactionId: outcomeData.transactionId || prev?.transactionId,
        status: outcomeData.status,
        provider: 'mock'
      }));
    }

    // Refresh authoritative booking and payment records from MongoDB
    await fetchBookingAndPayment(false);
  };

  /**
   * Handles User Retrying Failed Payment
   */
  const handleRetryPayment = async () => {
    setPayment(null);
    setCheckoutSession(null);
    await initCheckoutSession(id);
    await fetchBookingAndPayment(false);
  };

  /**
   * Handles Stripe Success
   */
  const handleStripeSuccess = async () => {
    await fetchBookingAndPayment(false);
  };

  /**
   * Handles Stripe Failure
   */
  const handleStripeFailed = async () => {
    await fetchBookingAndPayment(false);
  };

  // State 1: Main Loading State
  if (isLoading) {
    return (
      <div className="hold-page-container" data-testid="hold-loading-container">
        <div className="auth-loading-container" role="status" aria-live="polite">
          <div className="auth-spinner" aria-hidden="true"></div>
          <p>Retrieving your reservation and payment details...</p>
        </div>
      </div>
    );
  }

  // State 11, 12, 13, 14: Error States (Not Found, Forbidden, Network Error)
  if (errorMessage) {
    const isForbidden = errorStatus === 403;
    const isNotFound = errorStatus === 404;

    return (
      <div className="hold-page-container" data-testid="hold-error-container">
        <div className="alert-error" role="alert">
          <span className="alert-icon">⚠️</span>
          <div className="alert-body">
            <h3>
              {isForbidden
                ? 'Access Denied'
                : isNotFound
                ? 'Reservation Not Found'
                : `Reservation Error ${errorStatus ? `(${errorStatus})` : ''}`}
            </h3>
            <p>
              {isForbidden
                ? 'You do not have permission to view or pay for this reservation. Please ensure you are logged into the account that created this booking.'
                : errorMessage}
            </p>
            <div className="alert-actions">
              <Link to="/rooms" className="btn-secondary">
                ← Return to Room Search
              </Link>
              {isForbidden && (
                <Link to="/login" className="btn-primary">
                  Switch Account / Log In
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const room = booking?.room;
  const hotel = booking?.hotel;
  const roomTypeLabel = formatRoomType(room?.roomType);
  const statusInfo = formatBookingStatus(booking?.status, holdTimer.expired);
  const isExpiringSoon = !holdTimer.expired && holdTimer.totalSeconds <= 180; // <= 3 minutes

  // State 10: Late Payment / Administrative Reconciliation check
  // Occurs if payment was completed but booking is cancelled, or if backend flagged requiresRefund
  const isReconciliationNeeded =
    payment?.status === 'completed' &&
    (booking?.status === 'cancelled' || holdTimer.expired);

  const isConfirmed = booking?.status === 'confirmed';
  const isCancelled = booking?.status === 'cancelled';
  const isPending = booking?.status === 'pending';
  const isPaymentFailed = payment?.status === 'failed' && isPending;

  return (
    <div className="hold-page-container" data-testid="hold-page-container">
      {/* Flash Success Banner on New Booking Creation */}
      {isNewBooking && isPending && !holdTimer.expired && (
        <div className="alert-success" role="status" aria-live="polite">
          <span className="alert-icon">✅</span>
          <div className="alert-body">
            <strong>Reservation Hold Placed Successfully!</strong>
            <p>Your room is exclusively reserved while you complete payment.</p>
          </div>
        </div>
      )}

      {/* Top Banner: Status & Hold Countdown / Confirmation */}
      <section className="hold-status-banner">
        <div className="banner-header-row">
          <div>
            <span className="reference-label">Reservation Reference</span>
            <h1 className="booking-id-title font-mono" data-testid="booking-reference-id">
              {booking?._id}
            </h1>
          </div>
          <div className="banner-badges-row">
            <span className={`booking-status-pill ${statusInfo.variant}`} data-testid="booking-status-pill">
              {statusInfo.label}
            </span>
            {payment && (
              <PaymentStatusBadge status={payment.status} />
            )}
          </div>
        </div>

        {/* State 6: Booking Confirmed & Guaranteed */}
        {isConfirmed && (
          <div className="confirmed-banner-card" data-testid="booking-confirmed-card">
            <div className="confirmed-icon-col">
              <span className="confirmed-emoji" aria-hidden="true">🎉</span>
            </div>
            <div className="confirmed-content-col">
              <h2 className="confirmed-heading">Reservation Confirmed & Guaranteed!</h2>
              <p className="confirmed-description">
                Your payment has been successfully verified and processed. Your stay at{' '}
                <strong>{hotel?.name || 'HotelPro'}</strong> is locked in. We have sent a confirmation
                email to <strong>{booking?.guestInfo?.email}</strong>.
              </p>
              <div className="confirmed-actions">
                <Link to="/rooms" className="btn-primary">
                  Explore More Rooms
                </Link>
                <Link to="/profile" className="btn-secondary">
                  View My Account & Bookings
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* State 8: Active Reservation Hold or Expired Hold Countdown */}
        {isPending && (
          <div
            className={`hold-countdown-card ${
              holdTimer.expired
                ? 'hold-expired-state'
                : isExpiringSoon
                ? 'hold-warning-state'
                : 'hold-active-state'
            }`}
            data-testid="hold-countdown-card"
          >
            <div className="countdown-icon-col">
              <span className="countdown-emoji" aria-hidden="true">
                {holdTimer.expired ? '⌛' : isExpiringSoon ? '⏰' : '🔒'}
              </span>
            </div>

            <div className="countdown-content-col">
              {!holdTimer.expired ? (
                <div>
                  <h2 className="countdown-heading">
                    Exclusive Hold Countdown:{' '}
                    <span className="countdown-digits" data-testid="countdown-digits">
                      {holdTimer.formatted}
                    </span>
                  </h2>
                  <p className="countdown-description">
                    This room is locked and held for you until{' '}
                    <strong>
                      {booking?.holdExpiresAt
                        ? new Date(booking.holdExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : 'deadline'}
                    </strong>
                    . No other guest can reserve these dates while the hold is active.
                  </p>
                  {isExpiringSoon && (
                    <div className="expiring-warning-pill">
                      ⚠️ Less than 3 minutes remaining on this reservation hold! Complete payment now to guarantee your room.
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <h2 className="countdown-heading expired-title" data-testid="hold-expired-heading">
                    Reservation Hold Expired
                  </h2>
                  <p className="countdown-description">
                    The 15-minute reservation hold for this booking expired at{' '}
                    <strong>
                      {booking?.holdExpiresAt
                        ? new Date(booking.holdExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : ''}
                    </strong>
                    . The room dates have been released back to hotel inventory by our automated background worker.
                  </p>
                  <div className="hold-expired-actions">
                    <Link
                      to={room?._id ? `/rooms/${room._id}` : '/rooms'}
                      className="btn-primary"
                    >
                      Check Room Availability
                    </Link>
                    <Link to="/rooms" className="btn-secondary">
                      Search Available Rooms
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* State 9: Cancelled Booking (when not pending) */}
        {isCancelled && !isReconciliationNeeded && (
          <div className="cancelled-banner-card" data-testid="booking-cancelled-card">
            <div className="cancelled-icon-col">
              <span className="cancelled-emoji" aria-hidden="true">🚫</span>
            </div>
            <div className="cancelled-content-col">
              <h2 className="cancelled-heading">Reservation Cancelled</h2>
              <p className="cancelled-description">
                This reservation has been cancelled. Any previous hold on room dates has been released.
              </p>
              <div className="cancelled-actions">
                <Link to="/rooms" className="btn-primary">
                  Search Available Rooms
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* State 10: Reconciliation Notice */}
        {isReconciliationNeeded && (
          <PaymentReconciliationNotice
            booking={booking}
            payment={payment}
            reason="Payment was completed after the reservation hold expired."
          />
        )}
      </section>

      {/* Booking Details Card Grid */}
      <div className="hold-details-grid">
        {/* Left Column: Room & Stay Information */}
        <div className="hold-card">
          <h2>Room & Stay Information</h2>

          <div className="room-info-block">
            <span className="room-type-tag">{roomTypeLabel}</span>
            <h3 className="room-name">Room {room?.roomNumber}</h3>
            <p className="hotel-name">{hotel?.name}</p>
            {hotel?.address && <p className="hotel-address">{hotel.address}</p>}
          </div>

          <div className="stay-dates-card">
            <div className="stay-date-box">
              <span className="box-label">Check-in</span>
              <span className="box-val">{formatDateDisplay(booking?.checkInDate)}</span>
            </div>
            <div className="stay-arrow" aria-hidden="true">→</div>
            <div className="stay-date-box">
              <span className="box-label">Check-out</span>
              <span className="box-val">{formatDateDisplay(booking?.checkOutDate)}</span>
            </div>
          </div>

          <div className="specs-table">
            <div className="specs-row">
              <span className="spec-name">Total Nights</span>
              <span className="spec-value">
                {booking?.priceSnapshot?.nightlyBreakdown?.length || 1} nights
              </span>
            </div>
            <div className="specs-row">
              <span className="spec-name">Reserved Guests</span>
              <span className="spec-value">{booking?.guestCount} guests</span>
            </div>
            <div className="specs-row">
              <span className="spec-name">Room Max Capacity</span>
              <span className="spec-value">{room?.capacity} guests</span>
            </div>
          </div>
        </div>

        {/* Right Column: Price Snapshot & Interactive Payment Checkout */}
        <div className="hold-card checkout-card-col">
          <h2>Payment & Price Snapshot</h2>

          {/* Authoritative Price Snapshot */}
          <div className="price-snapshot-block">
            <h4>Authoritative Rate Snapshot</h4>
            <div className="snapshot-total-box">
              <span>Total Payable Amount:</span>
              <span className="snapshot-total-val" data-testid="total-amount-display">
                {formatCurrency(booking?.totalAmount, booking?.currency)}
              </span>
            </div>

            {Array.isArray(booking?.priceSnapshot?.nightlyBreakdown) && (
              <div className="snapshot-nightly-list">
                <span className="list-title">Nightly Rate Breakdown:</span>
                {booking.priceSnapshot.nightlyBreakdown.map((item) => (
                  <div key={item.date} className="snapshot-nightly-row">
                    <span>{item.date}</span>
                    <strong>${item.rate}</strong>
                  </div>
                ))}
              </div>
            )}

            <div className="snapshot-notes">
              <p>
                ✓ Server-calculated rate guaranteed at reservation time. No hidden fees or taxes will be added.
              </p>
            </div>
          </div>

          {/* Guest Information Summary */}
          <div className="guest-info-block">
            <h4>Primary Guest Details</h4>
            <p><strong>Name:</strong> {booking?.guestInfo?.name}</p>
            <p><strong>Email:</strong> {booking?.guestInfo?.email}</p>
            {booking?.guestInfo?.phone && <p><strong>Phone:</strong> {booking.guestInfo.phone}</p>}
          </div>

          {/* =========================================================================
              INTERACTIVE PAYMENT CHECKOUT SECTION (Phase 10 Implementation)
              ========================================================================= */}
          <div className="interactive-payment-section" data-testid="interactive-payment-section">
            {/* If payment is completed or refunded: Show authoritative Payment Summary */}
            {payment && ['completed', 'refunded', 'partially_refunded'].includes(payment.status) && (
              <PaymentSummary payment={payment} booking={booking} />
            )}

            {/* State 7: Payment Failed Alert with Retry Button */}
            {isPaymentFailed && (
              <div className="payment-failed-card" data-testid="payment-failed-card">
                <div className="failed-header">
                  <span className="failed-icon">❌</span>
                  <div>
                    <h3>Payment Attempt Failed</h3>
                    <p>Your previous payment attempt was declined or could not be completed.</p>
                  </div>
                </div>

                {!holdTimer.expired ? (
                  <button
                    type="button"
                    className="btn-primary btn-retry-payment"
                    onClick={handleRetryPayment}
                    disabled={isSessionLoading}
                    data-testid="retry-payment-btn"
                  >
                    {isSessionLoading ? 'Preparing New Attempt...' : 'Try Payment Again'}
                  </button>
                ) : (
                  <p className="failed-expired-note">
                    Your 15-minute hold has expired. Please check room availability to start a new reservation.
                  </p>
                )}
              </div>
            )}

            {/* State 3: Checkout Session Initializing */}
            {isSessionLoading && (
              <div className="payment-loading-box" role="status" aria-live="polite">
                <div className="auth-spinner" aria-hidden="true"></div>
                <p>Initializing secure checkout session...</p>
              </div>
            )}

            {/* Session Error */}
            {sessionError && (
              <div className="alert-error" role="alert">
                <span className="alert-icon">⚠️</span>
                <div className="alert-body">
                  <strong>Checkout Gateway Error</strong>
                  <p>{sessionError}</p>
                  <button
                    type="button"
                    className="btn-secondary btn-retry-session"
                    onClick={() => initCheckoutSession(id)}
                  >
                    Retry Loading Checkout
                  </button>
                </div>
              </div>
            )}

            {/* State 4 & 5: Active Checkout Forms (Mock or Stripe) */}
            {isPending && !holdTimer.expired && !isPaymentFailed && checkoutSession && (
              <div className="checkout-active-container">
                {checkoutSession.provider === 'mock' ? (
                  <MockCheckoutForm
                    paymentId={checkoutSession.paymentId}
                    amount={booking.totalAmount}
                    currency={booking.currency}
                    onSimulationComplete={handleSimulationComplete}
                    isHoldExpired={holdTimer.expired}
                  />
                ) : checkoutSession.provider === 'stripe' ? (
                  <StripeCheckoutForm
                    clientSecret={checkoutSession.clientSecret}
                    amount={booking.totalAmount}
                    currency={booking.currency}
                    bookingId={booking._id}
                    onPaymentSuccess={handleStripeSuccess}
                    onPaymentFailed={handleStripeFailed}
                    isHoldExpired={holdTimer.expired}
                  />
                ) : (
                  <div className="alert-error" role="alert">
                    <p>Unsupported payment provider: {checkoutSession.provider}</p>
                  </div>
                )}
              </div>
            )}

            {/* Fallback "Proceed to Payment" button if session is not yet loaded */}
            {isPending && !holdTimer.expired && !isPaymentFailed && !checkoutSession && !isSessionLoading && (
              <div className="checkout-cta-box">
                <button
                  type="button"
                  className="btn-primary btn-proceed-payment"
                  onClick={() => initCheckoutSession(id)}
                >
                  Proceed to Secure Payment
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookingHoldPage;
