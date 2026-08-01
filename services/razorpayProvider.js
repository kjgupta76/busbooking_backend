/**
 * RazorpayProvider
 *
 * Implements the pluggable payment gateway interface required by paymentService.js:
 *   - createPaymentIntent(orderId, amount)
 *   - verifyPayment(payload)
 *   - verifyWebhook(header, payload)
 *   - processRefund(gatewayTransactionId, amount)
 *
 * Registration: calls paymentService.registerGateway("RAZORPAY", razorpayProvider)
 * at module load so the provider is available from startup.
 *
 * Activation: set PAYMENT_GATEWAY=RAZORPAY in .env to route new bookings
 * through Razorpay instead of MOCK_GATEWAY. The mock remains untouched.
 */
console.log("this page is actuvated ")
const Razorpay = require("razorpay");
const crypto = require("crypto");
const paymentService = require("./paymentService");
const CustomError = require("../utils/createCustomError");
const { PaymentError } = CustomError;

// ─── Razorpay SDK Instance ──────────────────────────────────────────────────────
// Lazily validated: if keys are placeholders the instance is still created,
// but API calls will return 401 from Razorpay — caught and surfaced as PaymentError.
const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── Provider Implementation ────────────────────────────────────────────────────

const razorpayProvider = {
  /**
   * createPaymentIntent
   *
   * Creates a Razorpay Order for the given internal orderId and amount.
   * Razorpay expects amount in paise (smallest currency unit), so we multiply by 100.
   *
   * @param {string} orderId   - Internal MongoDB Order _id (used as receipt)
   * @param {number} amount    - Amount in rupees (e.g. 499)
   * @returns {{ gatewayTransactionId: string, paymentUrl: string, rawResponse: object }}
   */
  createPaymentIntent: async (orderId, amount) => {
    try {
      const options = {
        amount: Math.round(amount * 100), // convert ₹ to paise
        currency: "INR",
        // Unique per attempt so resume / passenger-edit can create a new order
        receipt: `${String(orderId).slice(-10)}_${Date.now()}`.slice(0, 40),
        payment_capture: 1,
      };

      const razorpayOrder = await razorpayInstance.orders.create(options);
      console.log("razorpayOrder", razorpayOrder);
      return {
        gatewayTransactionId: razorpayOrder.id,
        paymentUrl: `https://api.razorpay.com/v1/orders/${razorpayOrder.id}`,
        rawResponse: razorpayOrder,
      };
    } catch (error) {
      throw new PaymentError(
        `Razorpay order creation failed: ${error.error?.description || error.message}`,
        502
      );
    }
  },

  /**
   * verifyPayment
   *
   * Validates the HMAC-SHA256 signature sent by Razorpay after a successful
   * frontend payment. The frontend must pass:
   *   { razorpay_order_id, razorpay_payment_id, razorpay_signature }
   *
   * @param {object} payload  - Object containing the three Razorpay fields above
   * @returns {{ success: boolean, gatewayTransactionId: string, rawResponse: object, error?: string }}
   */
  verifyPayment: async (payload) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = payload;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return {
        success: false,
        error: "Missing Razorpay signature fields in payload",
        rawResponse: payload,
      };
    }

    try {
      // Razorpay signature = HMAC-SHA256(order_id + "|" + payment_id, key_secret)
      const body = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest("hex");

      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, "hex"),
        Buffer.from(razorpay_signature, "hex")
      );

      if (!isValid) {
        return {
          success: false,
          error: "Razorpay signature verification failed",
          rawResponse: payload,
        };
      }

      return {
        success: true,
        gatewayTransactionId: razorpay_payment_id,
        rawResponse: payload,
      };
    } catch (error) {
      return {
        success: false,
        error: `Signature verification error: ${error.message}`,
        rawResponse: payload,
      };
    }
  },

  /**
   * verifyWebhook
   *
   * Validates incoming Razorpay webhook events using the webhook secret.
   * Razorpay sends the signature in the "X-Razorpay-Signature" header.
   *
   * Expected header object: { "x-razorpay-signature": "<signature>" }
   * Payload must be the raw request body string (not parsed JSON).
   *
   * @param {object} header   - Request headers object
   * @param {string} payload  - Raw webhook body string
   * @returns {{ paymentId: string|null, status: string, gatewayTransactionId: string, rawResponse: object, error?: string }}
   */
  verifyWebhook: async (header, payload) => {
    const signature = header["x-razorpay-signature"];

    if (!signature) {
      return {
        paymentId: null,
        status: "FAILED",
        gatewayTransactionId: null,
        error: "Missing X-Razorpay-Signature header",
        rawResponse: {},
      };
    }

    try {
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(payload)
        .digest("hex");

      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, "hex"),
        Buffer.from(signature, "hex")
      );

      if (!isValid) {
        return {
          paymentId: null,
          status: "FAILED",
          gatewayTransactionId: null,
          error: "Webhook signature mismatch",
          rawResponse: {},
        };
      }

      // Parse the raw body now that signature is confirmed valid
      const event = typeof payload === "string" ? JSON.parse(payload) : payload;
      const eventType = event.event; // e.g. "payment.captured", "payment.failed"

      let status = "UNKNOWN";
      if (eventType === "payment.captured" || eventType === "order.paid") {
        status = "SUCCESS";
      } else if (eventType === "payment.failed") {
        status = "FAILED";
      }

      // Extract Razorpay payment entity from webhook payload
      const paymentEntity = event.payload?.payment?.entity || {};
      const gatewayTransactionId = paymentEntity.id || null;   // rzp payment_id
      // paymentId here is the Razorpay order receipt which we set to our internal orderId
      const receipt = event.payload?.order?.entity?.receipt || paymentEntity.order_id || null;

      return {
        paymentId: receipt,           // our internal orderId stored as receipt
        status,
        gatewayTransactionId,
        rawResponse: event,
      };
    } catch (error) {
      return {
        paymentId: null,
        status: "FAILED",
        gatewayTransactionId: null,
        error: `Webhook processing error: ${error.message}`,
        rawResponse: {},
      };
    }
  },

  /**
   * processRefund
   *
   * Issues a full or partial refund against a Razorpay payment_id.
   *
   * @param {string} gatewayTransactionId  - Razorpay payment_id (e.g. "pay_xxxxxxxxxx")
   * @param {number} amount                - Refund amount in rupees
   * @returns {{ success: boolean, refundId: string, rawResponse: object, error?: string }}
   */
  processRefund: async (gatewayTransactionId, amount) => {
    try {
      const refund = await razorpayInstance.payments.refund(gatewayTransactionId, {
        amount: Math.round(amount * 100), // convert ₹ to paise
      });

      return {
        success: true,
        refundId: refund.id,          // e.g. "rfnd_xxxxxxxxxx"
        rawResponse: refund,
      };
    } catch (error) {
      return {
        success: false,
        refundId: null,
        error: `Razorpay refund failed: ${error.error?.description || error.message}`,
        rawResponse: error.error || {},
      };
    }
  },
};

// ─── Register in Strategy Pattern ───────────────────────────────────────────────
// "RAZORPAY" is the gateway name used in payment records and PAYMENT_GATEWAY env var.
paymentService.registerGateway("RAZORPAY", razorpayProvider);

console.log("[RazorpayProvider] Registered under gateway name: RAZORPAY");
console.log("[razorpayProviderY",razorpayProvider);
console.log("[process.env.RAZORPAY_KEY_ID",process.env.RAZORPAY_KEY_ID);
console.log("[process.env.RAZORPAY_KEY_SECRET",process.env.RAZORPAY_KEY_SECRET);

module.exports = razorpayProvider;
