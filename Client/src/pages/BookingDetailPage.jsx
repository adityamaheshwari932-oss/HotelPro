import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getBookingDetails, cancelBooking } from '../api/bookingApi';
import { getBookingPayment } from '../api/paymentApi';
import { ApiError } from '../api/client';
import {
  formatDateDisplay,
  formatBookingStatus,
  formatPaymentStatus,
  formatCurrency,
  calculateRemainingHoldTime
} from '../utils/bookingUtils';
import { formatRoomType } from '../utils/roomFormatters';
import { PaymentSummary } from '../components/payment';

export const BookingDetailPage = () => {
  const { id } = useParams();

  const [booking, setBooking] = useState(null);
  const [payment, setPayment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorStatus, setErrorStatus] = useState(null);

  // Cancellation modal & submission state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [cancelSuccessMsg, setCancelSuccessMsg] = useState('');

  const isMountedRef = useRef(true);

  const fetchDetails = useCallback(async () => {
    if (!id) return;
    await Promise.resolve();
    if (!isMountedRef.current) return;
    setIsLoading(true);
    setErrorMessage('');
    setErrorStatus(null);

    try {
      const [bookingRes, paymentRes] = await Promise.allSettled([
        getBookingDetails(id),
        getBookingPayment(id)
      ]);

      if (!isMountedRef.current) return;

      if (bookingRes.status === 'fulfilled') {
        const b = bookingRes.value?.data?.booking;
        if (!b) {
          setErrorStatus(404);
          setErrorMessage('Reservation not found.');
          setIsLoading(false);
          return;
        }
        setBooking(b);
      } else {
        const err = bookingRes.reason;
        if (err instanceof ApiError) {
          setErrorStatus(err.status);
          setErrorMessage(err.message || 'Unable to retrieve reservation details.');
        } else {
          setErrorStatus(500);
          setErrorMessage('Unable to connect to reservation service.');
        }
        setIsLoading(false);
        return;
      }

      if (paymentRes.status === 'fulfilled') {
        setPayment(paymentRes.value?.data?.payment || null);
      }

      setIsLoading(false);
    } catch (err) {
      if (!isMountedRef.current) return;
      setIsLoading(false);
      if (err instanceof ApiError) {
        setErrorStatus(err.status);
        setErrorMessage(err.message);
      } else {
        setErrorStatus(500);
        setErrorMessage('Failed to load reservation details.');
      }
    }
  }, [id]);

  useEffect(() => {
    isMountedRef.current = true;
    void Promise.resolve().then(() => {
      fetchDetails();
    });

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchDetails]);

  const handleConfirmCancel = async (e) => {
    e.preventDefault();
    if (isCancelling) return;

    setIsCancelling(true);
    setCancelError('');

    try {
      const response = await cancelBooking(id, cancelReason.trim());
      const updatedBooking = response?.data?.booking;

      if (isMountedRef.current) {
        if (updatedBooking) {
          setBooking(updatedBooking);
        }
        setShowCancelModal(false);
        setCancelSuccessMsg('Your reservation has been cancelled successfully.');
        // Refresh payment & booking records to obtain refund metadata
        await fetchDetails();
      }
    } catch (err) {
      if (isMountedRef.current) {
        if (err instanceof ApiError) {
          setCancelError(err.message || 'Cancellation failed.');
        } else {
          setCancelError('Unable to connect to cancellation service.');
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsCancelling(false);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="bookings-page-container">
        <div className="auth-loading-container" role="status" aria-live="polite" data-testid="detail-loading">
          <div className="auth-spinner" aria-hidden="true"></div>
          <p>Retrieving reservation details...</p>
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="bookings-page-container" data-testid="detail-error">
        <div className="alert-error" role="alert">
          <span className="alert-icon">⚠️</span>
          <div className="alert-body">
            <h3>Reservation Error {errorStatus ? `(${errorStatus})` : ''}</h3>
            <p>{errorMessage}</p>
            <div className="alert-actions">
              <Link to="/my-bookings" className="btn-secondary">
                ← Return to My Bookings
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const room = booking?.room || {};
  const hotel = booking?.hotel || {};
  const holdInfo = calculateRemainingHoldTime(booking?.holdExpiresAt);
  const isHoldExpired = booking?.status === 'pending' && holdInfo.expired;
  const statusInfo = formatBookingStatus(booking?.status, isHoldExpired);
  const paymentStatusInfo = payment ? formatPaymentStatus(payment.status) : null;
  const nights = booking?.priceSnapshot?.nightlyBreakdown?.length || 1;

  // Cancellation eligibility:
  // Customers may cancel while status is 'pending' or 'confirmed'
  const isCancellable =
    (booking?.status === 'pending' || booking?.status === 'confirmed') &&
    !isHoldExpired;

  // Distinct refund status evaluation (Feature C critical requirement):
  // 1. Not cancelled
  // 2. Cancelled without payment
  // 3. Cancelled with completed refund
  // 4. Cancelled with pending / eligible refund
  // 5. Cancelled with refund failure / reconciliation needed
  const isCancelled = booking?.status === 'cancelled';
  const hasCompletedPayment = payment?.status === 'completed';
  const refundStatus = payment?.refund?.status || 'none';
  const refundAmount = payment?.refund?.amount || 0;

  return (
    <div className="bookings-page-container" data-testid="booking-detail-page">
      {/* Top Breadcrumb & Actions */}
      <div className="detail-top-bar">
        <Link to="/my-bookings" className="btn-back-link" data-testid="back-to-bookings-link">
          ← Back to My Bookings
        </Link>
        <div className="detail-header-badges">
          <span className={`booking-status-pill ${statusInfo.variant}`} data-testid="detail-booking-status">
            {statusInfo.label}
          </span>
          {paymentStatusInfo && (
            <span className={`payment-status-badge ${paymentStatusInfo.variant}`} data-testid="detail-payment-status">
              {paymentStatusInfo.label}
            </span>
          )}
        </div>
      </div>

      {/* Cancellation Success Alert */}
      {cancelSuccessMsg && (
        <div className="alert-success" role="status" aria-live="polite" data-testid="cancel-success-alert">
          <span className="alert-icon">✓</span>
          <div className="alert-body">
            <strong>Reservation Cancelled</strong>
            <p>{cancelSuccessMsg}</p>
          </div>
        </div>
      )}

      {/* Main Reservation Header */}
      <section className="detail-header-card">
        <div className="header-meta-row">
          <div>
            <span className="meta-label">Reservation Reference</span>
            <h1 className="meta-ref font-mono" data-testid="detail-booking-id">
              {booking?._id}
            </h1>
          </div>
          <div className="header-created-col">
            <span className="meta-label">Created</span>
            <span className="meta-val">
              {booking?.createdAt ? new Date(booking.createdAt).toLocaleString() : 'N/A'}
            </span>
          </div>
        </div>

        {/* Pending Hold Reminder */}
        {booking?.status === 'pending' && !isHoldExpired && (
          <div className="detail-hold-alert">
            <span>🔒 Temporary Reservation Hold Active: <strong>{holdInfo.formatted}</strong></span>
            <Link to={`/bookings/${booking._id}`} className="btn-primary-small">
              Proceed to Complete Payment
            </Link>
          </div>
        )}
      </section>

      {/* Detailed Information Grid */}
      <div className="detail-content-grid">
        {/* Left Column: Room & Stay Information */}
        <div className="detail-section-card">
          <h2>Room & Stay Information</h2>

          <div className="detail-room-box">
            <span className="room-type-tag">{formatRoomType(room.roomType)}</span>
            <h3 className="room-title">Room {room.roomNumber}</h3>
            <p className="hotel-title">{hotel.name}</p>
            {hotel.address && <p className="hotel-subaddress">{hotel.address}</p>}
            {hotel.contact?.phone && <p className="hotel-phone">📞 {hotel.contact.phone}</p>}
          </div>

          <div className="stay-dates-card">
            <div className="stay-date-box">
              <span className="box-label">Check-in</span>
              <strong className="box-val">{formatDateDisplay(booking?.checkInDate)}</strong>
            </div>
            <div className="stay-arrow" aria-hidden="true">→</div>
            <div className="stay-date-box">
              <span className="box-label">Check-out</span>
              <strong className="box-val">{formatDateDisplay(booking?.checkOutDate)}</strong>
            </div>
          </div>

          <div className="detail-specs-table">
            <div className="specs-row">
              <span className="spec-name">Total Duration</span>
              <span className="spec-value">{nights} {nights === 1 ? 'night' : 'nights'}</span>
            </div>
            <div className="specs-row">
              <span className="spec-name">Guest Count</span>
              <span className="spec-value">{booking?.guestCount} guests</span>
            </div>
            <div className="specs-row">
              <span className="spec-name">Room Capacity</span>
              <span className="spec-value">{room.capacity || 'N/A'} guests</span>
            </div>
          </div>

          <div className="guest-info-block">
            <h4>Primary Guest on Record</h4>
            <p><strong>Name:</strong> {booking?.guestInfo?.name}</p>
            <p><strong>Email:</strong> {booking?.guestInfo?.email}</p>
            {booking?.guestInfo?.phone && <p><strong>Phone:</strong> {booking.guestInfo.phone}</p>}
          </div>
        </div>

        {/* Right Column: Price Snapshot & Financials */}
        <div className="detail-section-card">
          <h2>Financial Snapshot & Receipts</h2>

          <div className="price-snapshot-block">
            <h4>Contractually Binding Price Snapshot</h4>
            <div className="snapshot-total-box">
              <span>Total Stay Price:</span>
              <span className="snapshot-total-val font-mono" data-testid="detail-total-amount">
                {formatCurrency(booking?.totalAmount, booking?.currency)}
              </span>
            </div>

            {Array.isArray(booking?.priceSnapshot?.nightlyBreakdown) && (
              <div className="snapshot-nightly-list">
                <span className="list-title">Nightly Breakdown:</span>
                {booking.priceSnapshot.nightlyBreakdown.map((item) => (
                  <div key={item.date} className="snapshot-nightly-row">
                    <span>{item.date}</span>
                    <strong className="font-mono">${item.rate}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payment Summary */}
          {payment ? (
            <div className="detail-payment-wrapper">
              <PaymentSummary payment={payment} booking={booking} />

              {['completed', 'refunded', 'partially_refunded'].includes(payment.status) && (
                <div className="receipt-action-row">
                  <Link
                    to={`/payments/${payment._id}/receipt`}
                    className="btn-primary btn-print-receipt-link"
                    data-testid="view-receipt-btn"
                  >
                    🧾 View & Print Payment Receipt
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="no-payment-notice">
              <p>No settled payment has been recorded for this reservation.</p>
              {booking?.status === 'pending' && !isHoldExpired && (
                <Link to={`/bookings/${booking._id}`} className="btn-primary">
                  Pay Now to Guarantee Room
                </Link>
              )}
            </div>
          )}

          {/* Cancellation & Refund Status Card */}
          <div className="cancellation-status-box" data-testid="cancellation-status-box">
            <h4>Reservation Lifecycle & Cancellation</h4>

            {isCancelled ? (
              <div className="cancelled-info-alert">
                <p>
                  <strong>Status:</strong> Cancelled on{' '}
                  {booking?.cancellation?.cancelledAt
                    ? new Date(booking.cancellation.cancelledAt).toLocaleString()
                    : 'record'}
                  .
                </p>
                {booking?.cancellation?.reason && (
                  <p><strong>Reason:</strong> {booking.cancellation.reason}</p>
                )}

                {/* Critical distinction between cancellation and refund status */}
                <div className="refund-lifecycle-status" data-testid="refund-lifecycle-status">
                  <span className="subhead">Refund Processing Status:</span>
                  {refundStatus === 'completed' ? (
                    <div className="refund-pill pill-completed">
                      ✓ Refund Completed: {formatCurrency(refundAmount, booking?.currency)} was issued
                      back to your original payment method.
                    </div>
                  ) : hasCompletedPayment ? (
                    <div className="refund-pill pill-pending">
                      ⏳ Refund Pending: Payment of {formatCurrency(payment?.amount, payment?.currency)}{' '}
                      was recorded. Our automated system has flagged this booking for administrative
                      refund review.
                    </div>
                  ) : (
                    <div className="refund-pill pill-none">
                      ℹ️ No payment was charged for this reservation. No refund is due.
                    </div>
                  )}
                </div>
              </div>
            ) : isCancellable ? (
              <div className="cancellation-action-area">
                <p className="cancellation-policy-note">
                  Need to cancel? You can cancel your reservation before check-in. Room dates will be
                  released immediately.
                </p>
                <button
                  type="button"
                  className="btn-danger-outline"
                  onClick={() => setShowCancelModal(true)}
                  data-testid="open-cancel-modal-btn"
                >
                  Cancel This Reservation
                </button>
              </div>
            ) : (
              <p className="cancellation-disallowed-note">
                {['checked_in', 'checked_out'].includes(booking?.status)
                  ? 'This booking cannot be cancelled because the stay has already commenced or concluded.'
                  : 'This reservation is no longer eligible for cancellation.'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Self-Service Cancellation */}
      {showCancelModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" data-testid="cancel-modal">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Confirm Reservation Cancellation</h3>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setShowCancelModal(false)}
                disabled={isCancelling}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p className="modal-warning-text">
                Are you sure you want to cancel your reservation for <strong>Room {room.roomNumber}</strong>{' '}
                at <strong>{hotel.name}</strong>?
              </p>
              <div className="modal-consequences-box">
                <ul>
                  <li>Your room dates will immediately be released back to hotel inventory.</li>
                  <li>This action is permanent and cannot be reversed online.</li>
                  {hasCompletedPayment ? (
                    <li>
                      Payment of <strong>{formatCurrency(payment?.amount, payment?.currency)}</strong> was
                      received. Cancellation will initiate our administrative refund workflow according to
                      hotel cancellation terms.
                    </li>
                  ) : (
                    <li>No charge has been collected; your reservation hold will simply terminate.</li>
                  )}
                </ul>
              </div>

              {cancelError && (
                <div className="alert-error modal-alert" role="alert">
                  <p>{cancelError}</p>
                </div>
              )}

              <div className="form-group modal-reason-group">
                <label htmlFor="cancel-reason-input">Reason for Cancellation (Optional):</label>
                <textarea
                  id="cancel-reason-input"
                  className="form-textarea"
                  rows="3"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Change of travel plans, unexpected schedule change, etc."
                  disabled={isCancelling}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowCancelModal(false)}
                disabled={isCancelling}
              >
                Keep Reservation
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleConfirmCancel}
                disabled={isCancelling}
                data-testid="confirm-cancel-btn"
              >
                {isCancelling ? 'Cancelling Reservation...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookingDetailPage;
