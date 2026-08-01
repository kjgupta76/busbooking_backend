/**
 * Payment Controller — POST /payment/verify
 *
 * Verifies the Razorpay signature returned after checkout, then
 * delegates the full atomic state transition to the existing
 * handlePaymentSuccess() / handlePaymentFailure() from bookingService.
 *
 * Why we verify with crypto directly instead of paymentService.verifyPayment():
 * paymentService.verifyPayment() writes payment status to the DB OUTSIDE a
 * transaction. handlePaymentSuccess() then writes inside its own transaction.
 * If handlePaymentSuccess fails, we'd have payment=SUCCESS / booking=PENDING.
 * By keeping verification as a pure crypto check (no DB side-effects), all DB
 * writes happen atomically inside the existing transaction helpers only.
 */

const crypto = require("crypto");
const router = require("express").Router();
const authenticateUser = require("../utils/authenticateUser");
const catchAsyncError = require("../middlewares/catchAsyncError");
const CustomError = require("../utils/createCustomError");
const { PaymentError } = CustomError;
const paymentModel = require("../models/payment");
const orderModel = require("../models/order");
const {
  handlePaymentSuccess,
  handlePaymentFailure,
} = require("../services/bookingService");

// ─── POST /payment/verify ────────────────────────────────────────────────────────
router.post(
  "/verify",
  authenticateUser,
  catchAsyncError(async (req, res) => {
    const {
      paymentId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    // 1. Input validation
    if (!paymentId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new PaymentError(
        "Missing required fields: paymentId, razorpay_order_id, razorpay_payment_id, razorpay_signature",
        400
      );
    }

    // 2. Load payment → order to obtain bookingId
    const payment = await paymentModel.findById(paymentId);
    if (!payment) {
      throw new PaymentError("Payment record not found", 404);
    }

    const order = await orderModel.findById(payment.orderId);
    if (!order) {
      throw new PaymentError("Order record not found", 404);
    }

    const bookingId = order.bookingId;
    const orderId   = order._id;

    // 3. Verify Razorpay HMAC-SHA256 signature (pure check — no DB writes)
    // Razorpay's spec: sign( razorpay_order_id + "|" + razorpay_payment_id, key_secret )
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    let signatureValid = false;
    try {
      // timingSafeEqual prevents timing-attack leaks on signature comparison
      signatureValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, "hex"),
        Buffer.from(razorpay_signature, "hex")
      );
    } catch (_) {
      // Buffer.from will throw if the signature string is malformed (wrong length etc.)
      signatureValid = false;
    }

    // 4. Branch: success or failure — both handled by existing transaction helpers
    if (signatureValid) {
      // Atomically: Booking→CONFIRMED, Order→PAID, Payment→SUCCESS, Seats LOCKED→BOOKED
      await handlePaymentSuccess(bookingId, orderId, paymentId, razorpay_payment_id);

      return res.status(200).json({
        success: true,
        message: "Payment verified. Booking confirmed.",
      });
    } else {
      // Payment verify failed: mark payment FAILED; seats stay LOCKED; booking stays PENDING
      await handlePaymentFailure(
        bookingId,
        orderId,
        paymentId,
        "Razorpay signature verification failed"
      );

      return res.status(400).json({
        success: false,
        message: "Payment verification failed. Invalid signature.",
      });
    }
  })
);

// ─── POST /payment/webhook ───────────────────────────────────────────────────────
// No authenticateUser — requests originate from Razorpay servers, not users.
// Must always return HTTP 200 on recognised events; Razorpay retries on non-200.
const { refundPayment } = require("../services/bookingService");

router.post(
  "/webhook",
  catchAsyncError(async (req, res) => {
    // 1. Signature verification over the raw body bytes
    const rawBody  = req.rawBody || JSON.stringify(req.body);
    const signature = req.headers["x-razorpay-signature"];

    if (!signature) {
      return res.status(400).json({ success: false, message: "Missing X-Razorpay-Signature header" });
    }

    if (!process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET.includes("REPLACE_ME")) {
      console.error("[Webhook] RAZORPAY_WEBHOOK_SECRET not configured");
      return res.status(500).json({ success: false, message: "Webhook secret not configured" });
    }

    const expectedSig = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    let isValid = false;
    try {
      isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSig,  "hex"),
        Buffer.from(signature,    "hex")
      );
    } catch (_) { isValid = false; }

    if (!isValid) {
      console.error("[Webhook] Signature mismatch — possible tampered event, ignoring");
      return res.status(400).json({ success: false, message: "Invalid webhook signature" });
    }

    // 2. Parse event (req.body already parsed by express.json)
    const event     = req.body;
    const eventType = event.event;
    console.log(`[Webhook] Received: ${eventType}`);

    // ── Helper: load payment record by Razorpay order_id (stored as gatewayTransactionId) ──
    const paymentByRzpOrderId = async (rzpOrderId) =>
      rzpOrderId ? paymentModel.findOne({ gatewayTransactionId: rzpOrderId }) : null;

    // ── payment.captured / order.paid ────────────────────────────────────────────
    if (eventType === "payment.captured" || eventType === "order.paid") {
      const paymentEntity = event.payload?.payment?.entity || {};
      const rzpOrderId    = event.payload?.order?.entity?.id || paymentEntity.order_id;
      const rzpPaymentId  = paymentEntity.id; // pay_xxx — used as transactionId

      const payment = await paymentByRzpOrderId(rzpOrderId);
      if (!payment) {
        console.log(`[Webhook] ${eventType}: no payment for rzp order ${rzpOrderId}, skipping`);
        return res.status(200).json({ success: true, message: "Skipped: payment not found" });
      }

      // IDEMPOTENCY: /payment/verify already confirmed this booking
      if (payment.status === "SUCCESS") {
        console.log(`[Webhook] ${eventType}: payment ${payment._id} already SUCCESS, skipping`);
        return res.status(200).json({ success: true, message: "Already processed" });
      }

      const order = await orderModel.findById(payment.orderId);
      if (!order) {
        return res.status(200).json({ success: true, message: "Skipped: order not found" });
      }

      await handlePaymentSuccess(order.bookingId, order._id, payment._id, rzpPaymentId);
      console.log(`[Webhook] ${eventType}: booking ${order.bookingId} → CONFIRMED`);
      return res.status(200).json({ success: true, message: "Booking confirmed" });
    }

    // ── payment.failed ───────────────────────────────────────────────────────────
    if (eventType === "payment.failed") {
      const paymentEntity = event.payload?.payment?.entity || {};
      const rzpOrderId    = event.payload?.order?.entity?.id || paymentEntity.order_id;
      const errorDesc     = paymentEntity.error_description || paymentEntity.error_reason || "Payment failed";

      const payment = await paymentByRzpOrderId(rzpOrderId);
      if (!payment) {
        console.log(`[Webhook] payment.failed: no payment for rzp order ${rzpOrderId}, skipping`);
        return res.status(200).json({ success: true, message: "Skipped: payment not found" });
      }

      // IDEMPOTENCY: already in a terminal state
      if (payment.status === "FAILED") {
        console.log(`[Webhook] payment.failed: payment ${payment._id} already FAILED, skipping`);
        return res.status(200).json({ success: true, message: "Already processed" });
      }
      // /payment/verify confirmed it first — do NOT roll back a confirmed booking
      if (payment.status === "SUCCESS") {
        console.log(`[Webhook] payment.failed: payment ${payment._id} already SUCCESS, refusing rollback`);
        return res.status(200).json({ success: true, message: "Skipped: booking already confirmed" });
      }

      const order = await orderModel.findById(payment.orderId);
      if (!order) {
        return res.status(200).json({ success: true, message: "Skipped: order not found" });
      }

      await handlePaymentFailure(order.bookingId, order._id, payment._id, errorDesc);
      console.log(`[Webhook] payment.failed: payment ${payment._id} → FAILED, seats remain LOCKED`);
      return res.status(200).json({
        success: true,
        message: "Failure recorded; seats remain locked until TTL",
      });
    }

    // ── refund.processed ─────────────────────────────────────────────────────────
    if (eventType === "refund.processed") {
      const refundEntity = event.payload?.refund?.entity || {};
      const rzpPaymentId = refundEntity.payment_id; // pay_xxx set as transactionId on SUCCESS

      if (!rzpPaymentId) {
        return res.status(200).json({ success: true, message: "Skipped: no payment_id in refund event" });
      }

      // transactionId = razorpay pay_xxx, set by handlePaymentSuccess
      const payment = await paymentModel.findOne({ transactionId: rzpPaymentId });
      if (!payment) {
        console.log(`[Webhook] refund.processed: no payment for rzp payment ${rzpPaymentId}, skipping`);
        return res.status(200).json({ success: true, message: "Skipped: payment not found" });
      }

      // IDEMPOTENCY: already refunded
      if (payment.status === "REFUNDED") {
        console.log(`[Webhook] refund.processed: payment ${payment._id} already REFUNDED, skipping`);
        return res.status(200).json({ success: true, message: "Already processed" });
      }

      // Atomically: Payment→REFUNDED, Order→REFUNDED, Booking→CANCELLED, Seats deleted
      await refundPayment(payment._id);
      console.log(`[Webhook] refund.processed: payment ${payment._id} → REFUNDED`);
      return res.status(200).json({ success: true, message: "Refund recorded" });
    }

    // ── Unhandled event — acknowledge so Razorpay does not retry ─────────────────
    console.log(`[Webhook] Unhandled event type: ${eventType}`);
    return res.status(200).json({ success: true, message: `Event '${eventType}' acknowledged` });
  })
);

// ─── POST /payment/refund ────────────────────────────────────────────────────────
// Initiates a Razorpay refund for a confirmed booking (payment.status === SUCCESS).
// Flow: Razorpay refund API → payment.status = REFUNDED.
// The "refund.processed" webhook (Phase 5) then calls bookingService.refundPayment()
// to atomically update booking → CANCELLED, order → REFUNDED, seats → deleted.
// This separation avoids any double-update race between synchronous and async paths.
const paymentService = require("../services/paymentService");

router.post(
  "/refund",
  authenticateUser,
  catchAsyncError(async (req, res) => {
    const { paymentId, amount } = req.body;

    if (!paymentId) {
      throw new PaymentError("paymentId is required", 400);
    }

    // Load payment and verify ownership
    const payment = await paymentModel.findById(paymentId);
    if (!payment) throw new PaymentError("Payment record not found", 404);

    if (payment.userId.toString() !== req.id) {
      throw new PaymentError("Unauthorized: payment does not belong to this user", 403);
    }

    if (payment.status !== "SUCCESS") {
      throw new PaymentError(
        `Cannot refund a payment with status '${payment.status}'. Only SUCCESS payments can be refunded.`,
        400
      );
    }

    // processRefund via Razorpay (strategy pattern) + marks payment.status = REFUNDED
    // bookingService.refundPayment() runs asynchronously via the refund.processed webhook
    const result = await paymentService.refundPayment(paymentId, amount || null);

    if (!result.success) {
      throw new PaymentError(
        result.error || "Razorpay refund request failed",
        502
      );
    }

    console.log(`[Refund] payment ${paymentId} → refund initiated, refundId: ${result.refundId}`);

    return res.status(200).json({
      success: true,
      message: "Refund initiated. Your booking will be cancelled and amount returned shortly.",
      refundId: result.refundId,
    });
  })
);

module.exports = router;
