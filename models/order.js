const { Schema, model } = require("mongoose");

const orderSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
    },
    amount: {
      type: Number,
      required: true,
      min: [0, "Amount cannot be negative"],
    },
    status: {
      type: String,
      enum: ["PENDING", "PAID", "FAILED", "CANCELLED", "REFUNDED"],
      default: "PENDING",
      required: true,
    },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1 });

const orderModel = model("Order", orderSchema);

module.exports = orderModel;
