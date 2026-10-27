import React, { useState } from 'react';
import { simulateMockPayment } from '../../api/paymentApi';
import { ApiError } from '../../api/client';
import { formatCurrency } from '../../utils/bookingUtils';

/**
 * Mock Checkout Form for development and automated testing environments.
 *
 * SAFETY & INTEGRITY GUARANTEES:
 * 1. Prominently informs the user this is a non-monetary development flow.
 * 2. Never accepts or requests raw payment credentials, card numbers, or CVVs.
 * 3. Never calls the public webhook endpoint directly from the browser.
 * 4. Calls the authenticated POST /api/payments/:id/simulate-mock endpoint.
 * 5. Fences against duplicate submissions while an action is in-flight.
 * 6. Authoritative state is verified by refreshing the parent component.
 *
 * @param {{
 *   paymentId: string,
 *   amount: number,
 *   currency?: string,
 *   onSimulationComplete: (outcomeData: object) => void,
 *   isHoldExpired?: boolean
 * }} props
 */
export const MockCheckoutForm = ({
  paymentId,
  amount,
  currency = 'USD',
  onSimulationComplete,
  isHoldExpired = false
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingOutcome, setSubmittingOutcome] = useState(null); // 'success' | 'failure' | null
  const [errorStatus, setErrorStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSimulate = async (outcome) => {
    if (isSubmitting || isHoldExpired) return;

    setIsSubmitting(true);
    setSubmittingOutcome(outcome);
    setErrorStatus(null);
    setErrorMessage('');

    try {
      const payload = {
        outcome,
        failureReason: outcome === 'failure' ? 'Simulated card decline in test environment' : undefined
      };

      const response = await simulateMockPayment(paymentId, payload);
      const outcomeData = response?.data || {};

      if (typeof onSimulationComplete === 'function') {
        onSimulationComplete(outcomeData);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorStatus(err.status);
        setErrorMessage(err.message || `Simulation failed with status ${err.status}`);
      } else {
        setErrorStatus(500);
        setErrorMessage(err.message || 'Unable to connect to mock payment simulation service.');
      }
    } finally {
      setIsSubmitting(false);
      setSubmittingOutcome(null);
    }
  };

  return (
    <div className="mock-checkout-container" data-testid="mock-checkout-container">
      {/* Dev Environment Notice Banner */}
      <div className="mock-env-notice">
        <span className="notice-badge">DEVELOPMENT / MOCK PAYMENT</span>
        <p className="notice-text">
          HotelPro is running in <strong>Mock Payment Provider</strong> mode. No real credit card
          or financial charge will occur. Use the simulation controls below to verify the complete
          checkout lifecycle.
        </p>
      </div>

      <div className="mock-checkout-summary">
        <div className="mock-amount-row">
          <span className="mock-amount-label">Payable Balance:</span>
          <span className="mock-amount-value">{formatCurrency(amount, currency)}</span>
        </div>
        <div className="mock-meta-row">
          <span className="mock-meta-label">Payment ID:</span>
          <span className="mock-meta-value font-mono">{paymentId}</span>
        </div>
      </div>

      {/* Error Feedback */}
      {errorMessage && (
        <div className="alert-error mock-alert" role="alert">
          <span className="alert-icon">⚠️</span>
          <div className="alert-body">
            <strong>Simulation Error {errorStatus ? `(${errorStatus})` : ''}</strong>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Simulation Action Controls */}
      <div className="mock-actions-container">
        <button
          type="button"
          className="btn-mock-success"
          disabled={isSubmitting || isHoldExpired}
          onClick={() => handleSimulate('success')}
          aria-label="Simulate Successful Payment"
          data-testid="simulate-success-btn"
        >
          {isSubmitting && submittingOutcome === 'success' ? (
            <span className="btn-spinner-content">
              <span className="btn-spinner" aria-hidden="true"></span>
              Processing Success...
            </span>
          ) : (
            <>
              <span className="btn-icon">✓</span>
              Simulate Successful Payment
            </>
          )}
        </button>

        <button
          type="button"
          className="btn-mock-failure"
          disabled={isSubmitting || isHoldExpired}
          onClick={() => handleSimulate('failure')}
          aria-label="Simulate Failed Payment"
          data-testid="simulate-failure-btn"
        >
          {isSubmitting && submittingOutcome === 'failure' ? (
            <span className="btn-spinner-content">
              <span className="btn-spinner" aria-hidden="true"></span>
              Processing Failure...
            </span>
          ) : (
            <>
              <span className="btn-icon">✕</span>
              Simulate Failed Payment
            </>
          )}
        </button>
      </div>

      {isHoldExpired && (
        <p className="mock-disabled-note">
          ⚠️ Reservation hold has expired. Payment simulations are disabled.
        </p>
      )}
    </div>
  );
};

export default MockCheckoutForm;
