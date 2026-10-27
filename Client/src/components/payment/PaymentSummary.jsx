import React from 'react';
import PaymentStatusBadge from './PaymentStatusBadge';
import { formatCurrency, formatDateDisplay } from '../../utils/bookingUtils';

/**
 * Displays an authoritative receipt and summary of payment details.
 *
 * @param {{
 *   payment: object,
 *   booking?: object,
 *   className?: string
 * }} props
 */
export const PaymentSummary = ({ payment, booking, className = '' }) => {
  if (!payment) return null;

  const cardBrand = payment.paymentMethod?.cardBrand || '';
  const cardLast4 = payment.paymentMethod?.cardLast4 || '';
  const formattedAmount = formatCurrency(
    payment.amount !== undefined ? payment.amount : booking?.totalAmount,
    payment.currency || booking?.currency || 'USD'
  );

  return (
    <div className={`payment-summary-card ${className}`} data-testid="payment-summary-card">
      <div className="payment-summary-header">
        <h3 className="payment-summary-title">Payment Record</h3>
        <PaymentStatusBadge status={payment.status} />
      </div>

      <div className="payment-summary-amount-row">
        <span className="payment-label">Amount:</span>
        <span className="payment-amount-val">{formattedAmount}</span>
      </div>

      <div className="payment-summary-details-grid">
        <div className="summary-field">
          <span className="field-label">Payment ID</span>
          <span className="field-value font-mono">{payment._id}</span>
        </div>

        {payment.transactionId && (
          <div className="summary-field">
            <span className="field-label">Transaction ID</span>
            <span className="field-value font-mono">{payment.transactionId}</span>
          </div>
        )}

        <div className="summary-field">
          <span className="field-label">Provider</span>
          <span className="field-value capitalize">{payment.provider || 'mock'}</span>
        </div>

        {(cardBrand || cardLast4) && (
          <div className="summary-field">
            <span className="field-label">Payment Method</span>
            <span className="field-value">
              {cardBrand.toUpperCase()} {cardLast4 ? `•••• ${cardLast4}` : ''}
            </span>
          </div>
        )}

        {payment.createdAt && (
          <div className="summary-field">
            <span className="field-label">Date Processed</span>
            <span className="field-value">
              {formatDateDisplay(payment.createdAt)} {new Date(payment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}

        {payment.refund && payment.refund.status !== 'none' && (
          <div className="summary-field refund-field">
            <span className="field-label">Refund Status</span>
            <span className="field-value">
              {payment.refund.status.toUpperCase()} ({formatCurrency(payment.refund.amount, payment.currency)})
              {payment.refund.reason && ` - ${payment.refund.reason}`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default PaymentSummary;
