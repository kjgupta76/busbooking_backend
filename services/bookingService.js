const { bookingModel } = require("../models/booking");
const tripModel = require("../models/trip");
const seatModel = require("../models/seat");
const orderModel = require("../models/order");
const paymentModel = require("../models/payment");
const { Types } = require("mongoose");
const CustomError = require("../utils/createCustomError");
const { ValidationError, SeatLockError, BookingError, PaymentError } = CustomError;
const mongoose = require("mongoose");

// Validation helper
const validateBookingData = (bookingData) => {
  const { tripId, boardingPointId, droppingPointId, seatsInfo, pocDetails } = bookingData;

  if (
    !tripId ||
    boardingPointId == null ||
    droppingPointId == null ||
    !seatsInfo ||
    !pocDetails
  ) {
    throw new ValidationError("Booking details missing");
  }

  if (!Array.isArray(seatsInfo) || seatsInfo.length === 0) {
    throw new ValidationError("Seats information is required");
  }

  for (const seat of seatsInfo) {
    if (!seat.seatNumber || !seat.name || seat.age == null || !seat.gender) {
      throw new ValidationError("Invalid seat information");
    }
    if (!["M", "F", "O"].includes(seat.gender)) {
      throw new ValidationError("Invalid gender value");
    }
  }

  if (!pocDetails.phoneNumber || !pocDetails.email) {
    throw new ValidationError("Invalid point of contact details");
  }

  if (!Types.ObjectId.isValid(tripId)) {
    throw new ValidationError("Invalid trip id");
  }
};

// Seat Reservation Helper (Lock seats within session)
const reserveSeats = async (session, tripId, userId, seatsInfo, bookingId) => {
  const seatNumbers = seatsInfo.map((s) => s.seatNumber);

  // Check if seats are already occupied (locked or booked)
  const existingSeats = await seatModel.find({
    tripId,
    seatNumber: { $in: seatNumbers },
  }).session(session);
  console.log("existingSeats at reserved seat", existingSeats);
  if (existingSeats.length > 0) {
    const lockedOrBookedNumbers = existingSeats.map((s) => s.seatNumber).join(", ");
    throw new SeatLockError(`Seat(s) ${lockedOrBookedNumbers} are already locked or booked`);
  }

  // Create temporary Seat documents with status "LOCKED" and configurable expireAt timestamp for TTL
  const lockTimeoutSeconds = Number(process.env.LOCK_TIMEOUT_SECONDS) || 600;
  const expireAt = new Date(Date.now() + lockTimeoutSeconds * 1000);
  const seatsToLock = seatsInfo.map((seat) => ({
    tripId,
    seatNumber: seat.seatNumber,
    status: "LOCKED",
    bookingId,
    userId,
    gender: seat.gender,
    expireAt,
  }));
  console.log("seatsToLock", seatsToLock);
  try {
    const lockedSeatInserted = await seatModel.insertMany(seatsToLock, { session });
    console.log("lockedSeatInserted", lockedSeatInserted)
  } catch (error) {
    // If concurrent write conflict occurred (due to unique compound index), handle as seat already locked
    if (error.code === 11000) {
      throw new SeatLockError("One or more seats have already been locked by another user. Please choose another seat.");
    }
    throw error;
  }
};

// Simulated Payment Gateway Helper
const callPaymentGateway = async (bookingData, amount) => {
  // Short simulated network latency
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Allow test script or request body to trigger simulated failure
  if (bookingData.simulatePaymentFailure === true) {
    return { success: false, transactionId: null, error: "Payment declined by issuing bank" };
  }

  const transactionId = "TXN_" + Math.random().toString(36).substring(2, 15).toUpperCase();
  return { success: true, transactionId };
};

// Commit helper for finalizing payment success state
const handlePaymentSuccess = async (bookingId, orderId, paymentId, transactionId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Update booking status
    const bookingupdate = await bookingModel.findByIdAndUpdate(bookingId, { status: "CONFIRMED" }, { session });
    console.log("bookingupdate", bookingupdate)
    // Update order status
    const orderupdate = await orderModel.findByIdAndUpdate(orderId, { status: "PAID", paymentId }, { session });
    console.log("orderupdate", orderupdate)
    // Update payment status

    const pyamentSuccess = await paymentModel.findByIdAndUpdate(paymentId, { status: "SUCCESS", transactionId }, { session });
    console.log("pyamentSuccess", pyamentSuccess);
    // Transition Seat locks to BOOKED and unset expireAt (disables TTL expiration)
    const seatUpdated = await seatModel.updateMany(
      { bookingId },
      { $set: { status: "BOOKED" }, $unset: { expireAt: "" } },
      { session }
    );
    console.log("seatUpdated", seatUpdated)
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Rollback helper for payment failure state
const handlePaymentFailure = async (bookingId, orderId, paymentId, errorMessage) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Update booking status and release idempotencyKey
    const booking = await bookingModel.findById(bookingId).session(session);
    if (booking) {
      booking.status = "FAILED";
      if (booking.idempotencyKey) {
        booking.idempotencyKey = `${booking.idempotencyKey}_failed_${Date.now()}`;
      }
      await booking.save({ session });
    }

    // Update order status
    await orderModel.findByIdAndUpdate(orderId, { status: "FAILED" }, { session });

    // Update payment status
    await paymentModel.findByIdAndUpdate(paymentId, { status: "FAILED", errorMessage }, { session });

    // Remove seat locks (makes seats AVAILABLE again immediately)
    await seatModel.deleteMany({ bookingId }, { session });

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Rollback helper for booking expiry state
const handleBookingExpiry = async (bookingId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const booking = await bookingModel.findById(bookingId).session(session);
    if (!booking) {
      throw new BookingError("Booking not found", 404);
    }

    if (booking.status === "PENDING") {
      booking.status = "EXPIRED";
      if (booking.idempotencyKey) {
        booking.idempotencyKey = `${booking.idempotencyKey}_expired_${Date.now()}`;
      }
      await booking.save({ session });

      await orderModel.findOneAndUpdate(
        { bookingId: booking._id },
        { status: "FAILED" },
        { session }
      );

      const order = await orderModel.findOne({ bookingId: booking._id }).session(session);
      if (order) {
        await paymentModel.findOneAndUpdate(
          { orderId: order._id },
          { status: "FAILED", errorMessage: "Booking session expired" },
          { session }
        );
      }

      await seatModel.deleteMany({ bookingId: booking._id }, { session });
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Rollback helper for user cancellation requests
const cancelBooking = async (bookingId, userId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const booking = await bookingModel.findOne({ _id: bookingId, userId }).session(session);
    if (!booking) {
      throw new BookingError("Booking not found", 404);
    }

    if (booking.status === "CANCELLED") {
      throw new BookingError("Booking is already cancelled", 400);
    }

    if (booking.status === "EXPIRED" || booking.status === "FAILED") {
      throw new BookingError("Cannot cancel an expired or failed booking", 400);
    }

    const previousStatus = booking.status;
    booking.status = "CANCELLED";
    if (booking.idempotencyKey) {
      booking.idempotencyKey = `${booking.idempotencyKey}_cancelled_${Date.now()}`;
    }
    await booking.save({ session });

    const order = await orderModel.findOneAndUpdate(
      { bookingId: booking._id },
      { status: previousStatus === "CONFIRMED" ? "REFUNDED" : "CANCELLED" },
      { session, new: true }
    );

    if (order) {
      await paymentModel.findOneAndUpdate(
        { orderId: order._id },
        { status: previousStatus === "CONFIRMED" ? "REFUNDED" : "FAILED" },
        { session }
      );
    }

    await seatModel.deleteMany({ bookingId: booking._id }, { session });

    await session.commitTransaction();
    return booking;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Rollback helper for refund requests
const refundPayment = async (paymentId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const payment = await paymentModel.findById(paymentId).session(session);
    if (!payment) {
      throw new PaymentError("Payment record not found", 404);
    }

    if (payment.status === "REFUNDED") {
      throw new PaymentError("Payment is already refunded", 400);
    }

    payment.status = "REFUNDED";
    await payment.save({ session });

    const order = await orderModel.findByIdAndUpdate(
      payment.orderId,
      { status: "REFUNDED" },
      { session, new: true }
    );

    if (order) {
      const booking = await bookingModel.findById(order.bookingId).session(session);
      if (booking) {
        booking.status = "CANCELLED";
        if (booking.idempotencyKey) {
          booking.idempotencyKey = `${booking.idempotencyKey}_cancelled_${Date.now()}`;
        }
        await booking.save({ session });
      }
      await seatModel.deleteMany({ bookingId: order.bookingId }, { session });
    }

    await session.commitTransaction();
    return payment;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Notification Helper Hook
const executeNotificationHook = async (booking) => {
  try {
    console.log(`[Notification Hook] Booking successfully confirmed! Booking ID: ${booking._id}, User ID: ${booking.userId}`);
  } catch (err) {
    console.error("[Notification Hook] Error running webhook notification:", err.message);
  }
};

const bookTrip = async (bookingData, userId) => {
  // 1. Validation
  validateBookingData(bookingData);
  const { tripId, boardingPointId, droppingPointId, seatsInfo, pocDetails } = bookingData;
  const trip = await tripModel.findById(tripId);
  if (!trip) {
    throw new ValidationError("Trip not found");
  }

  // Calculate pricing mapping
  const priceMap = {};
  trip.prices.forEach((p) => {
    priceMap[p.seatNumber] = p.price;
  });

  const seatsWithPrice = seatsInfo.map((seat) => ({
    seatNumber: seat.seatNumber,
    name: seat.name,
    gender: seat.gender,
    age: Number(seat.age),
    paidAmount: priceMap[seat.seatNumber] || 0,
  }));

  const totalAmount = seatsWithPrice.reduce((sum, seat) => sum + seat.paidAmount, 0);

  // Generate unique idempotency key based on trip, user, and sorted seats if not supplied by client
  const sortedSeats = [...seatsInfo].map((s) => s.seatNumber).sort();
  const idempotencyKey = bookingData.idempotencyKey || `book_${userId}_${tripId}_${sortedSeats.join('_')}`;

  // Check if any of the requested seats are already booked
  const seatNumbers = seatsInfo.map((s) => s.seatNumber);
  const alreadyBookedSeats = await seatModel.find({
    tripId,
    seatNumber: { $in: seatNumbers },
    status: "BOOKED"
  });

  if (alreadyBookedSeats.length > 0) {
    const bookedNumbers = alreadyBookedSeats.map((s) => s.seatNumber).join(", ");
    throw new SeatLockError(`Seat(s) ${bookedNumbers} are already booked`);
  }

  // Idempotency check 1: Fast return for already active booking
  const existingBooking = await bookingModel.findOne({ idempotencyKey });
  console.log("existingBooking,", existingBooking)

  if (existingBooking) {
    if (existingBooking.status === "CONFIRMED") {
      throw new SeatLockError(`Seat(s) ${seatNumbers.join(", ")} are already booked`);
    }
    if (existingBooking.status === "PENDING") {
      return existingBooking;
    }
  }
  // console.log("idempotencyKey,", idempotencyKey)


  // 2. Start transaction session 1: Create PENDING entities and Lock Seats
  const session = await mongoose.startSession();
  session.startTransaction();
  let booking, order, payment;

  try {
    booking = new bookingModel({
      tripId,
      userId,
      bookingTime: Math.floor(Date.now() / 1000),
      seatsInfo: seatsWithPrice,
      pocDetails,
      boardingPointId: Number(boardingPointId),
      droppingPointId: Number(droppingPointId),
      status: "PENDING",
      idempotencyKey,
    });
    await booking.save({ session });

    order = new orderModel({
      userId,
      bookingId: booking._id,
      amount: totalAmount,
      status: "PENDING",
    });
    await order.save({ session });

    payment = new paymentModel({
      orderId: order._id,
      userId,
      amount: totalAmount,
      gateway: "MOCK_GATEWAY",
      status: "CREATED",
    });
    const paymentcreated = await payment.save({ session });
    console.log("paymentcreated", paymentcreated);
    // Lock seats and link bookingId
    await reserveSeats(session, tripId, userId, seatsInfo, booking._id);

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();

    // Idempotency check 2: Handle race conditions under high concurrent double-submissions
    const isConflict =
      error.code === 11000 ||
      error.code === 112 ||
      error.message.includes("WriteConflict") ||
      error.message.includes("transaction") ||
      error.message.includes("retry");

    if (isConflict) {
      session.endSession();
      // Poll/wait up to 1 second for the concurrent insert/transaction to commit
      for (let i = 0; i < 20; i++) {
        const existing = await bookingModel.findOne({ idempotencyKey });
        if (existing) {
          return existing;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    if (
      error.code === 11000 ||
      error.code === 112 ||
      error.message.includes("WriteConflict") ||
      error.message.includes("transaction") ||
      error.message.includes("retry")
    ) {
      throw new SeatLockError("One or more seats have already been locked by another user. Please choose another seat.");
    }
    throw error;
  } finally {
    session.endSession();
  }

  return booking;
};

const getUserBookings = async (userId) => {
  if (!Types.ObjectId.isValid(userId)) {
    return [];
  }

  const bookings = await bookingModel
    .find({ userId, status: { $in: ["PENDING", "CONFIRMED"] } })
    .sort({ bookingTime: -1 })
    .populate({
      path: "tripId",
      populate: [
        { path: "source", select: "name state" },
        { path: "destination", select: "name state" },
        { path: "busId", select: "busPartner busType busNumber" },
      ],
    });

  return bookings.map((booking) => {
    const trip = booking.tripId;
    const totalPaid = (booking.seatsInfo || []).reduce(
      (sum, seat) => sum + (seat.paidAmount || 0),
      0
    );

    return {
      bookingId: booking._id,
      bookingTime: booking.bookingTime,
      seatsInfo: booking.seatsInfo,
      pocDetails: booking.pocDetails,
      boardingPointId: booking.boardingPointId,
      droppingPointId: booking.droppingPointId,
      totalPaid,
      trip: trip
        ? {
          tripId: trip._id,
          sourceCity: trip.source?.name,
          sourceState: trip.source?.state,
          destinationCity: trip.destination?.name,
          destinationState: trip.destination?.state,
          busPartner: trip.busId?.busPartner,
          busType: trip.busId?.busType,
          busNumber: trip.busId?.busNumber,
          departureTime: trip.startTime,
          arrivalTime: trip.endTime,
        }
        : null,
    };
  });
};

module.exports = {
  bookTrip,
  getUserBookings,
  handlePaymentSuccess,
  handlePaymentFailure,
  handleBookingExpiry,
  cancelBooking,
  refundPayment,
};
