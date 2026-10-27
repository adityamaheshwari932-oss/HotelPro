import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getPaymentById } from '../api/paymentApi';
import { PaymentStatusBadge } from '../components/payment/PaymentStatusBadge';
import { formatBookingReference, calculateRemainingHoldTime } from '../utils/bookingUtils';

export const PaymentReceiptPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const fetchPaymentDetails = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await getPaymentById(id);
        if (isMounted) {
          setPayment(res.data?.payment || null);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Unable to load payment receipt details.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    if (id) {
      fetchPaymentDetails();
    }

    return () => {
      isMounted = false;
    };
  }, [id]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="receipt-page-container loading-state" data-testid="receipt-loading">
        <div className="spinner" />
        <p>Loading payment summary and receipt details...</p>
      </div>
    );
  }

  if (error || !payment) {
    return (
      <div className="receipt-page-container error-state" data-testid="receipt-error">
        <div className="alert alert-error">
          <h3>Unable to Load Receipt</h3>
          <p>{error || 'Payment record not found.'}</p>
        </div>
        <div className="receipt-actions no-print">
          <button className="btn btn-secondary" onClick={() => navigate('/my-bookings')}>
            Return to My Bookings
          </button>
        </div>
      </div>
    );
  }

  const booking = payment.booking || {};
  const room = booking.room || {};
  const hotel = booking.hotel || {};
  const holdInfo = calculateRemainingHoldTime(booking.holdExpiresAt);
  const isBookingActiveHold =
    booking.status === 'pending' && holdInfo.hasHold && !holdInfo.expired;

  return (
    <div className="receipt-page-container" data-testid="payment-receipt-page">
      {/* Action bar (hidden in print) */}
      <div className="receipt-top-actions no-print">
        <Link
          to={booking._id ? `/my-bookings/${booking._id}` : '/my-bookings'}
          className="btn btn-secondary btn-sm"
        >
          &larr; Back to Booking Details
        </Link>
        <button
          className="btn btn-primary btn-sm"
          onClick={handlePrint}
          data-testid="print-receipt-btn"
        >
          Print Receipt Summary
        </button>
      </div>

      {/* Main Printable Card */}
      <div className="receipt-card" data-testid="printable-receipt">
        {/* Header */}
        <div className="receipt-header">
          <div className="receipt-brand">
            <h2>HotelPro</h2>
            <span className="receipt-badge-tag">Payment Confirmation Summary</span>
          </div>
          <div className="receipt-meta-header">
            <p className="receipt-id"><strong>Payment ID:</strong> {payment.id}</p>
            <p className="receipt-date">
              <strong>Date:</strong> {payment.createdAt ? new Date(payment.createdAt).toLocaleString() : 'N/A'}
            </p>
          </div>
        </div>

        {/* Notice of informal summary */}
        <div className="receipt-disclaimer-box">
          <p>
            This document is a printable payment confirmation summary for your records.
            It is not an official tax invoice.
          </p>
        </div>

        {/* Status Banner */}
        <div className="receipt-status-section">
          <div className="status-label-group">
            <span className="status-title">Payment Status:</span>
            <PaymentStatusBadge status={payment.status} />
          </div>

          {payment.status === 'failed' && (
            <div className="status-alert alert-warning">
              <strong>Notice:</strong> This payment attempt was not completed successfully.
              {payment.reconciliationReason && ` Reason: ${payment.reconciliationReason}`}
            </div>
          )}

          {payment.status === 'pending' && (
            <div className="status-alert alert-info">
              <strong>Notice:</strong> This payment is currently awaiting final confirmation from the payment provider.
            </div>
          )}
        </div>

        {/* Associated Reservation Info */}
        <div className="receipt-section">
          <h3 className="section-title">Associated Reservation</h3>
          <div className="receipt-info-grid">
            <div className="info-item">
              <span className="info-label">Booking Reference</span>
              <span className="info-value font-mono">
                {formatBookingReference(booking._id || '')}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Booking Status</span>
              <span className="info-value text-capitalize">
                {booking.status || 'Unknown'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Hotel</span>
              <span className="info-value">
                {hotel.name || 'HotelPro Destination'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Room</span>
              <span className="info-value">
                {room.type ? `${room.type} (Room ${room.roomNumber})` : 'Room Reservation'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Check-In</span>
              <span className="info-value">
                {booking.checkIn ? new Date(booking.checkIn).toLocaleDateString() : 'N/A'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Check-Out</span>
              <span className="info-value">
                {booking.checkOut ? new Date(booking.checkOut).toLocaleDateString() : 'N/A'}
              </span>
            </div>
          </div>
        </div>

        {/* Financial Breakdown */}
        <div className="receipt-section">
          <h3 className="section-title">Payment Breakdown</h3>
          <div className="receipt-table-wrapper">
            <table className="receipt-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Provider / Reference</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Room Accommodation</td>
                  <td>
                    <span className="text-muted text-capitalize">{payment.provider || 'Gateway'}</span>
                    {payment.transactionId && (
                      <span className="receipt-tx-id font-mono"> ({payment.transactionId})</span>
                    )}
                  </td>
                  <td className="text-right font-mono font-bold">
                    {payment.currency?.toUpperCase() || 'USD'} {Number(payment.amount || 0).toFixed(2)}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="total-row">
                  <td colSpan="2" className="text-right font-bold">Total Paid:</td>
                  <td className="text-right font-mono font-bold font-large">
                    {payment.currency?.toUpperCase() || 'USD'} {Number(payment.amount || 0).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Refund Details (if applicable) */}
        {(payment.refund || payment.status === 'refunded' || payment.reconciliationStatus === 'refund_eligible') && (
          <div className="receipt-section refund-summary-section">
            <h3 className="section-title text-warning">Refund Information</h3>
            <div className="refund-info-card">
              <p>
                <strong>Refund Status:</strong>{' '}
                <span className="font-semibold text-capitalize">
                  {payment.refund?.status || (payment.status === 'refunded' ? 'completed' : 'pending')}
                </span>
              </p>
              {payment.refund?.amount && (
                <p>
                  <strong>Refunded Amount:</strong>{' '}
                  <span className="font-mono">
                    {payment.refund.currency?.toUpperCase() || payment.currency?.toUpperCase() || 'USD'}{' '}
                    {Number(payment.refund.amount).toFixed(2)}
                  </span>
                </p>
              )}
              {payment.refund?.refundedAt && (
                <p>
                  <strong>Refunded On:</strong>{' '}
                  {new Date(payment.refund.refundedAt).toLocaleString()}
                </p>
              )}
              {payment.refund?.reason && (
                <p>
                  <strong>Reason:</strong> {payment.refund.reason}
                </p>
              )}
              {!payment.refund && payment.reconciliationStatus === 'refund_eligible' && (
                <p className="text-muted">
                  Cancellation processed. Refund is currently queued for administrative reconciliation.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Payment Recovery / Retry option */}
        {(payment.status === 'failed' || payment.status === 'pending') && booking._id && (
          <div className="receipt-section recovery-section no-print">
            <h3 className="section-title">Payment Recovery</h3>
            {isBookingActiveHold ? (
              <div className="recovery-action-box">
                <p>Your room hold is currently active. You may complete payment to confirm your stay.</p>
                <Link to={`/checkout/${booking._id}`} className="btn btn-primary">
                  Resume Checkout Now
                </Link>
              </div>
            ) : (
              <div className="recovery-notice-box">
                <p className="text-muted">
                  The reservation hold for this booking has expired or was cancelled.
                  To book this room, please return to room search to check current availability.
                </p>
                <Link to="/rooms" className="btn btn-secondary btn-sm">
                  Search Rooms
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="receipt-footer">
          <p>Thank you for choosing HotelPro.</p>
          <p className="text-muted text-sm">
            For inquiries or assistance, please contact customer support with your Payment ID ({payment.id}).
          </p>
        </div>
      </div>
    </div>
  );
};

export default PaymentReceiptPage;
