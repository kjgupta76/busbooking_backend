const paymentModel = require("../models/payment");
const CustomError = require("../utils/createCustomError");
const { PaymentError } = CustomError;

// Strategy pattern: Simple registry for pluggable gateways
const gateways = {};

const registerGateway = (name, providerInstance) => {
  gateways[name] = providerInstance;
};

const paymentService = {
  /**
   * Register a new pluggable payment gateway provider.
   * A provider must implement:
   * - createPaymentIntent(orderId, amount) -> returns { gatewayTransactionId, paymentUrl, rawResponse }
   * - verifyPayment(payload) -> returns { success, gatewayTransactionId, rawResponse, error }
   * - verifyWebhook(header, payload) -> returns { paymentId, status, gatewayTransactionId, rawResponse, error }
   * - processRefund(gatewayTransactionId, amount) -> returns { success, refundId, rawResponse, error }
   */
  registerGateway,

  /**
   * Initialize and record a payment attempt
   */
  createPaymentRecord: async (orderId, userId, amount, gatewayName, session = null) => {
    const payment = new paymentModel({
      orderId,
      userId,
      amount,
      gateway: gatewayName,
      status: "CREATED",
    });

    if (session) {
      await payment.save({ session });
    } else {
      await payment.save();
    }
    return payment;
  },

  /**
   * Update payment status and details
   */
  updatePaymentStatus: async (paymentId, status, details = {}, session = null) => {
    const update = { status };
    if (details.transactionId) update.transactionId = details.transactionId;
    if (details.gatewayTransactionId) update.gatewayTransactionId = details.gatewayTransactionId;
    if (details.errorMessage) update.errorMessage = details.errorMessage;
    if (details.refundId) update.refundId = details.refundId;
    if (details.rawResponse) update.rawResponse = details.rawResponse;

    const options = session ? { session, new: true } : { new: true };
    const payment = await paymentModel.findByIdAndUpdate(paymentId, update, options);
    if (!payment) {
      throw new PaymentError("Payment record not found", 404);
    }
    return payment;
  },

  /**
   * Initiate a payment intent via the selected gateway
  */
  initiatePayment: async (paymentId) => {
    const payment = await paymentModel.findById(paymentId);

    if (!payment) {
      throw new PaymentError("Payment record not found", 404);
    }

    const gatewayProvider = gateways[payment.gateway];

    if (!gatewayProvider) {
      throw new PaymentError(`Payment gateway '${payment.gateway}' is not registered or supported`, 400);
    }

    try {
      // Call pluggable gateway implementation
      const result = await gatewayProvider.createPaymentIntent(payment.orderId, payment.amount);
    console.log("gatewayProviderresult", result);
      
      // Update payment record with initiation details
      payment.gatewayTransactionId = result.gatewayTransactionId;
      payment.status = "PENDING";
      payment.rawResponse = result.rawResponse;
      await payment.save();

      return {
        paymentId: payment._id,
        paymentUrl: result.paymentUrl,
        gatewayTransactionId: result.gatewayTransactionId,
      };
    } catch (error) {
      payment.status = "FAILED";
      payment.errorMessage = error.message;
      await payment.save();
      throw error;
    }
  },

  /**
   * Verify an incoming payment payload (e.g., redirect response checking)
   */
  verifyPayment: async (paymentId, verificationPayload) => {
    const payment = await paymentModel.findById(paymentId);
    if (!payment) {
      throw new PaymentError("Payment record not found", 404);
    }

    const gatewayProvider = gateways[payment.gateway];
    if (!gatewayProvider) {
      throw new PaymentError(`Payment gateway '${payment.gateway}' is not registered`, 400);
    }

    const result = await gatewayProvider.verifyPayment(verificationPayload);
    
    if (result.success) {
      await paymentService.updatePaymentStatus(paymentId, "SUCCESS", {
        transactionId: result.gatewayTransactionId,
        rawResponse: result.rawResponse,
      });
    } else {
      await paymentService.updatePaymentStatus(paymentId, "FAILED", {
        errorMessage: result.error,
        rawResponse: result.rawResponse,
      });
    }

    return result;
  },

  /**
   * Handle incoming webhooks from any pluggable gateway
   */
  handleWebhook: async (gatewayName, webhookHeader, webhookPayload) => {
    const gatewayProvider = gateways[gatewayName];
    if (!gatewayProvider) {
      throw new PaymentError(`Payment gateway '${gatewayName}' is not registered`, 400);
    }

    // Parse and verify webhook signature/payload using the gateway provider
    const event = await gatewayProvider.verifyWebhook(webhookHeader, webhookPayload);
    
    if (event.paymentId) {
      if (event.status === "SUCCESS") {
        await paymentService.updatePaymentStatus(event.paymentId, "SUCCESS", {
          transactionId: event.gatewayTransactionId,
          rawResponse: event.rawResponse,
        });
      } else if (event.status === "FAILED") {
        await paymentService.updatePaymentStatus(event.paymentId, "FAILED", {
          errorMessage: event.error,
          rawResponse: event.rawResponse,
        });
      }
    }
    return event;
  },

  /**
   * Process a refund for a payment
   */
  refundPayment: async (paymentId, amount = null) => {
    const payment = await paymentModel.findById(paymentId);
    if (!payment) {
      throw new PaymentError("Payment record not found", 404);
    }

    if (payment.status !== "SUCCESS") {
      throw new PaymentError("Only successful payments can be refunded", 400);
    }

    const refundAmount = amount || payment.amount;

    const gatewayProvider = gateways[payment.gateway];
    if (!gatewayProvider) {
      throw new PaymentError(`Payment gateway '${payment.gateway}' is not registered`, 400);
    }

    const result = await gatewayProvider.processRefund(payment.transactionId || payment.gatewayTransactionId, refundAmount);
    
    if (result.success) {
      await paymentService.updatePaymentStatus(paymentId, "REFUNDED", {
        refundId: result.refundId,
        rawResponse: result.rawResponse,
      });
    }

    return result;
  }
};

// Register a Mock Provider by default so the application is functional out-of-the-box
const mockProvider = {
  createPaymentIntent: async (orderId, amount) => {
    return {
      gatewayTransactionId: "MOCK_GTX_" + Math.random().toString(36).substring(2, 9).toUpperCase(),
      paymentUrl: `https://mock-gateway.example.com/checkout?order=${orderId}&amount=${amount}`,
      rawResponse: { message: "Mock intent created successfully" }
    };
  },
  verifyPayment: async (payload) => {
    if (payload.simulateFailure) {
      return {
        success: false,
        error: "Mock payment verification failed due to simulated failure",
        rawResponse: payload
      };
    }
    return {
      success: true,
      gatewayTransactionId: payload.gatewayTransactionId || "MOCK_GTX_SUCCESS_123",
      rawResponse: payload
    };
  },
  verifyWebhook: async (header, payload) => {
    return {
      paymentId: payload.paymentId,
      status: payload.status || "SUCCESS",
      gatewayTransactionId: payload.gatewayTransactionId || "MOCK_GTX_WEBHOOK_123",
      error: payload.error,
      rawResponse: payload
    };
  },
  processRefund: async (gatewayTransactionId, amount) => {
    return {
      success: true,
      refundId: "MOCK_REF_" + Math.random().toString(36).substring(2, 9).toUpperCase(),
      rawResponse: { message: `Refunded ${amount} successfully for tx ${gatewayTransactionId}` }
    };
  }
};

paymentService.registerGateway("MOCK_GATEWAY", mockProvider);

module.exports = paymentService;
