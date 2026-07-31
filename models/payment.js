const { Schema, model } = require("mongoose");

const paymentSchema = new Schema(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0, "Amount cannot be negative"],
    },
    gateway: {
      type: String,
      default: "MOCK_GATEWAY",
      required: true,
    },
    transactionId: {
      type: String,
    },
    gatewayTransactionId: {
      type: String,
    },
    status: {
      type: String,
      enum: ["CREATED", "PENDING", "SUCCESS", "FAILED", "REFUNDED"],
      default: "CREATED",
      required: true,
    },
    errorMessage: {
      type: String,
    },
    refundId: {
      type: String,
    },
    rawResponse: {
      type: Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

paymentSchema.index({ orderId: 1 });
paymentSchema.index({ orderId: 1 }, { unique: true, partialFilterExpression: { status: "SUCCESS" }, name: "orderId_1_success" });
paymentSchema.index({ orderId: 1 }, { unique: true, partialFilterExpression: { status: "PENDING" }, name: "orderId_1_pending" });
paymentSchema.index({ transactionId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ gatewayTransactionId: 1 }, { unique: true, sparse: true });

const paymentModel = model("Payment", paymentSchema);

module.exports = paymentModel;
