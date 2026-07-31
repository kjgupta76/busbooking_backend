const { Schema, model } = require("mongoose");

const seatSchema = new Schema(
  {
    tripId: {
      type: Schema.Types.ObjectId,
      ref: "Trip",
      required: true,
    },
    seatNumber: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["LOCKED", "BOOKED"],
      required: true,
    },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    gender: {
      type: String,
      enum: ["M", "F", "O"],
    },
    expireAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Compound unique index to prevent multiple concurrent locks/bookings of the same seat on a trip
seatSchema.index({ tripId: 1, seatNumber: 1 }, { unique: true });
// **In MongoDB, the values 1 and -1 specify the sort order of the index keys:
// **When you define { tripId: 1, seatNumber: 1 }, MongoDB creates a balanced tree (B-Tree) data structure.


// TTL index to automatically remove locked seats when expireAt is reached (expireAfterSeconds: 0)
seatSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

const seatModel = model("Seat", seatSchema);

module.exports = seatModel;
