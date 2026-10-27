const paymentService = require('../services/payment.service');
const { validateRefundInput } = require('../validators/payment.validator');

/**
 * Initializes a new checkout session for a pending reservation.
 *
 * Route: POST /api/payments/checkout-session
 * Access: Protected (Customer)
 */
const createCheckoutSession = async (req, res, next) => {
  try {
    const checkoutSession = await paymentService.createCheckoutSession(req.body, req.user);

    res.status(201).json({
      success: true,
      message: 'Checkout session initialized successfully',
      data: {
        checkoutSession
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieves payment details by ID (Owner or Admin).
 *
 * Route: GET /api/payments/:id
 * Access: Protected (Owner / Admin)
 */
const getPaymentById = async (req, res, next) => {
  try {
    const payment = await paymentService.getPaymentById(req.params.id, req.user);

    res.status(200).json({
      success: true,
      data: {
        payment
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Processes a full or partial refund for a completed payment.
 *
 * Route: POST /api/payments/:id/refund
 * Access: Protected (Owner / Admin)
 */
const processRefund = async (req, res, next) => {
  try {
    const refundInput = validateRefundInput(req.body);
    const result = await paymentService.processRefund(
      {
        paymentId: req.params.id,
        ...refundInput
      },
      req.user
    );

    res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Lists reconciliation anomalies and required refunds (Admin only).
 *
 * Route: GET /api/payments/reconciliation
 * Access: Protected (Admin only)
 */
const listReconciliations = async (req, res, next) => {
  try {
    const result = await paymentService.listReconciliations(req.query, req.user);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Handles incoming asynchronous payment gateway webhook events.
 *
 * Route: POST /api/payments/webhook
 *        POST /api/payments/webhook/:provider
 * Access: Public (Authenticated via cryptographic provider signature)
 */
const handleWebhook = async (req, res, next) => {
  try {
    const providerName = req.params.provider || req.headers['x-payment-provider'] || 'mock';
    const rawBody = req.rawBody || req.body;
    const signature =
      req.headers['x-mock-signature'] ||
      req.headers['stripe-signature'] ||
      req.headers['paypal-signature'] ||
      req.headers['x-webhook-signature'];

    const outcome = await paymentService.processWebhook({
      providerName,
      rawBody,
      signature,
      headers: req.headers
    });

    if (outcome.unmapped || outcome.statusCode === 404) {
      return res.status(404).json(outcome);
    }

    res.status(200).json(outcome);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createCheckoutSession,
  getPaymentById,
  processRefund,
  listReconciliations,
  handleWebhook
};
