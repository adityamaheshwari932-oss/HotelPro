import React from 'react';
import { formatPaymentStatus } from '../../utils/bookingUtils';

/**
 * Renders a semantic pill badge indicating the payment status.
 *
 * @param {{ status: string, className?: string }} props
 */
export const PaymentStatusBadge = ({ status, className = '' }) => {
  const { label, variant } = formatPaymentStatus(status);

  return (
    <span
      className={`payment-status-badge ${variant} ${className}`}
      data-testid="payment-status-badge"
    >
      {label}
    </span>
  );
};

export default PaymentStatusBadge;
