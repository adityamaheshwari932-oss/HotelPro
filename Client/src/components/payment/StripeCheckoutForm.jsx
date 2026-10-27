import React, { useState, useEffect, useRef, useMemo } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js';
import { formatCurrency } from '../../utils/bookingUtils';
import { getBookingById, getBookingPayment } from '../../api/paymentApi';

/**
 * Inner Stripe checkout form mounted inside the <Elements> context.
 */
const StripePaymentForm = ({
  amount,
  currency = 'USD',
  bookingId,
  onPaymentSuccess,
  onPaymentFailed,
  isHoldExpired
}) => {
  const stripe = useStripe();
  const elements = useElements();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [processingStatus, setProcessingStatus] = useState(''); // Status message during webhook confirmation polling
  const isMountedRef = useRef(true);
  const pollingTimeoutRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
      }
    };
  }, []);

  /**
   * Bounded polling loop to refresh backend booking status after Stripe confirms intent.
   * This respects the backend architecture where webhooks confirm the booking asynchronously.
   */
  const pollAuthoritativeConfirmation = async (maxAttempts = 5, delayMs = 1500) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!isMountedRef.current) return;

      try {
        const [bookingRes, paymentRes] = await Promise.all([
          getBookingById(bookingId),
          getBookingPayment(bookingId)
        ]);

        const updatedBooking = bookingRes?.data?.booking;
        const updatedPayment = paymentRes?.data?.payment;

        if (updatedBooking?.status === 'confirmed' || updatedPayment?.status === 'completed') {
          if (isMountedRef.current) {
            setProcessingStatus('Booking confirmed!');
            onPaymentSuccess({ booking: updatedBooking, payment: updatedPayment });
          }
          return;
        }
      } catch {
        // Continue polling despite transient query error
      }

      if (attempt < maxAttempts) {
        setProcessingStatus(`Awaiting webhook confirmation (attempt ${attempt} of ${maxAttempts})...`);
        await new Promise((resolve) => {
          pollingTimeoutRef.current = setTimeout(resolve, delayMs);
        });
      }
    }

    // Final attempt if confirmation not yet reflected
    if (isMountedRef.current) {
      setProcessingStatus('');
      onPaymentSuccess({ pendingWebhook: true });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!stripe || !elements || isSubmitting || isHoldExpired) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setProcessingStatus('');

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required'
      });

      if (error) {
        if (isMountedRef.current) {
          setErrorMessage(error.message || 'Payment confirmation failed.');
          setIsSubmitting(false);
        }
        if (typeof onPaymentFailed === 'function') {
          onPaymentFailed(error);
        }
        return;
      }

      if (paymentIntent) {
        if (paymentIntent.status === 'succeeded') {
          if (isMountedRef.current) {
            setProcessingStatus('Payment authorized. Synchronizing with reservation service...');
          }
          await pollAuthoritativeConfirmation();
        } else if (paymentIntent.status === 'processing') {
          if (isMountedRef.current) {
            setProcessingStatus('Your payment is processing. Waiting for bank verification...');
          }
          await pollAuthoritativeConfirmation();
        } else if (paymentIntent.status === 'requires_payment_method') {
          if (isMountedRef.current) {
            setErrorMessage('Payment failed. Please provide a different payment method.');
            setIsSubmitting(false);
          }
          if (typeof onPaymentFailed === 'function') {
            onPaymentFailed({ message: 'Payment method declined' });
          }
        } else {
          if (isMountedRef.current) {
            setErrorMessage(`Payment intent status: ${paymentIntent.status}`);
            setIsSubmitting(false);
          }
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setErrorMessage(err.message || 'An unexpected error occurred during payment processing.');
        setIsSubmitting(false);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="stripe-checkout-form" data-testid="stripe-checkout-form">
      <div className="stripe-amount-header">
        <span>Payment Amount Due:</span>
        <strong className="stripe-amount-value">{formatCurrency(amount, currency)}</strong>
      </div>

      <div className="stripe-element-wrapper">
        <PaymentElement id="payment-element" options={{ layout: 'tabs' }} />
      </div>

      {errorMessage && (
        <div className="alert-error stripe-alert" role="alert">
          <span className="alert-icon">⚠️</span>
          <div className="alert-body">
            <strong>Payment Error</strong>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      {processingStatus && (
        <div className="alert-info stripe-alert" role="status" aria-live="polite">
          <span className="alert-icon">⏳</span>
          <div className="alert-body">
            <p>{processingStatus}</p>
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || !elements || isSubmitting || isHoldExpired}
        className="btn-stripe-submit"
        data-testid="stripe-submit-btn"
      >
        {isSubmitting ? (
          <span className="btn-spinner-content">
            <span className="btn-spinner" aria-hidden="true"></span>
            Processing Payment...
          </span>
        ) : (
          `Pay ${formatCurrency(amount, currency)}`
        )}
      </button>

      {isHoldExpired && (
        <p className="stripe-disabled-note">
          ⚠️ Reservation hold has expired. Payment cannot be submitted.
        </p>
      )}
    </form>
  );
};

/**
 * Top-level Stripe Checkout component that initializes Stripe and wraps the form in Elements.
 */
export const StripeCheckoutForm = ({
  clientSecret,
  amount,
  currency = 'USD',
  bookingId,
  onPaymentSuccess,
  onPaymentFailed,
  isHoldExpired = false
}) => {
  // Read publishable key from environment
  const publishableKey =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY) || '';

  // Memoize stripePromise to avoid reinitializing on every render
  const stripePromise = useMemo(() => {
    if (!publishableKey || publishableKey.includes('placeholder')) {
      return null;
    }
    try {
      return loadStripe(publishableKey);
    } catch {
      return null;
    }
  }, [publishableKey]);

  // Missing Configuration Handling (Workstream D.E requirement):
  // When Stripe is configured as the active provider but the publishable key is missing:
  // Display clear configuration error. Do NOT expose secrets. Do NOT silently switch to mock.
  if (!publishableKey || publishableKey.includes('placeholder')) {
    return (
      <div className="stripe-config-missing" data-testid="stripe-config-missing">
        <div className="alert-error" role="alert">
          <span className="alert-icon">⚙️</span>
          <div className="alert-body">
            <h3>Stripe Configuration Required</h3>
            <p>
              The reservation checkout requires the Stripe payment provider, but the frontend
              publishable key (<code>VITE_STRIPE_PUBLISHABLE_KEY</code>) has not been configured
              in the environment.
            </p>
            <p className="config-hint">
              Please set a valid Stripe publishable key (e.g. <code>pk_test_...</code>) in your{' '}
              <code>Client/.env</code> file to enable live card payments.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div className="stripe-loading-session" role="status">
        <div className="auth-spinner" aria-hidden="true"></div>
        <p>Initializing secure Stripe checkout session...</p>
      </div>
    );
  }

  const elementsOptions = {
    clientSecret,
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#2563eb',
        colorBackground: '#ffffff',
        colorText: '#1e293b',
        colorDanger: '#dc2626',
        borderRadius: '8px'
      }
    }
  };

  return (
    <div className="stripe-checkout-container" data-testid="stripe-checkout-container">
      <div className="stripe-trust-badge">
        <span className="badge-icon">🔒</span>
        <span>Secure Card Payment via Stripe (End-to-End Encrypted)</span>
      </div>

      {stripePromise ? (
        <Elements stripe={stripePromise} options={elementsOptions}>
          <StripePaymentForm
            amount={amount}
            currency={currency}
            bookingId={bookingId}
            onPaymentSuccess={onPaymentSuccess}
            onPaymentFailed={onPaymentFailed}
            isHoldExpired={isHoldExpired}
          />
        </Elements>
      ) : (
        <div className="alert-error" role="alert">
          <span className="alert-icon">⚠️</span>
          <div className="alert-body">
            <h3>Unable to initialize Stripe</h3>
            <p>Could not connect to the Stripe checkout SDK. Please refresh the page or check your connection.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default StripeCheckoutForm;
