const express = require('express');
const router = express.Router();

const paymentController = require('../controllers/payment.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

// Webhook endpoints for payment provider notifications (Public: verified via provider signature)
router.post('/webhook', paymentController.handleWebhook);
router.post('/webhook/:provider', paymentController.handleWebhook);

// Initialize checkout session for a pending booking (Customer)
router.post('/checkout-session', protect, paymentController.createCheckoutSession);

// List payment reconciliation anomalies & required refunds (Admin only)
// NOTE: Mounted before '/:id' to avoid Express route parameter collisions
router.get('/reconciliation', protect, restrictTo('admin'), paymentController.listReconciliations);

// Retrieve payment details by ID (Owner or Admin)
router.get('/:id', protect, paymentController.getPaymentById);

// Simulate mock payment outcome (Owner or Admin; Mock provider only)
router.post('/:id/simulate-mock', protect, paymentController.simulateMockPayment);

// Issue full or partial refund for a completed payment (Owner or Admin)
router.post('/:id/refund', protect, paymentController.processRefund);

module.exports = router;
