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
    // Present only while status === LOCKED. Unset on BOOKED so TTL can never remove booked seats.
    expireAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Compound unique index to prevent multiple concurrent locks/bookings of the same seat on a trip
seatSchema.index({ tripId: 1, seatNumber: 1 }, { unique: true });

// TTL removes only expired LOCKED seats (AVAILABLE again). BOOKED seats are excluded.
seatSchema.index(
  { expireAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { status: "LOCKED", expireAt: { $exists: true } },
    name: "locked_seat_ttl",
  }
);

const seatModel = model("Seat", seatSchema);

module.exports = seatModel;
