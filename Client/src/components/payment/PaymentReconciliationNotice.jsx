import React from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '../../utils/bookingUtils';

/**
 * Notice displayed when a payment was received but the booking was cancelled or
 * expired prior to payment completion, requiring administrative reconciliation.
 *
 * SAFETY GUARANTEE: Never claims the booking is confirmed when the hold expired.
 *
 * @param {{
 *   booking: object,
 *   payment: object,
 *   reason?: string
 * }} props
 */
export const PaymentReconciliationNotice = ({ booking, payment, reason }) => {
  const amountFormatted = formatCurrency(payment?.amount || booking?.totalAmount, payment?.currency || booking?.currency);

  return (
    <div className="reconciliation-notice-card" data-testid="reconciliation-notice">
      <div className="reconciliation-header">
        <span className="reconciliation-icon" aria-hidden="true">ℹ️</span>
        <div>
          <h3 className="reconciliation-title">Reservation Requires Administrative Attention</h3>
          <span className="reconciliation-badge">Reconciliation Pending</span>
        </div>
      </div>

      <div className="reconciliation-body">
        <p>
          We received your payment of <strong>{amountFormatted}</strong> (Reference:{' '}
          <code className="font-mono">{payment?.transactionId || payment?._id || 'N/A'}</code>).
        </p>
        <p>
          However, because the 15-minute reservation hold expired before payment settlement completed,
          the reserved room dates could not be confirmed automatically.
        </p>
        {reason && (
          <div className="reconciliation-reason-box">
            <span className="box-label">Reason:</span>
            <span className="box-val">{reason}</span>
          </div>
        )}
        <p className="reconciliation-action-text">
          Our administrative staff has been automatically notified. If the room is no longer
          available, your payment will be refunded in full to your original payment method.
        </p>
      </div>

      <div className="reconciliation-footer-actions">
        <Link to="/rooms" className="btn-primary">
          Search Available Rooms
        </Link>
        <Link to="/profile" className="btn-secondary">
          View My Account & Bookings
        </Link>
      </div>
    </div>
  );
};

export default PaymentReconciliationNotice;
