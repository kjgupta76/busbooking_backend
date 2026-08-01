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

const getLockTimeoutSeconds = () => {
  const parsed = Number(process.env.LOCK_TIMEOUT_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 240;
};

const seatsMatchExactly = (left = [], right = []) => {
  if (left.length !== right.length) return false;
  const a = [...left].map(String).sort();
  const b = [...right].map(String).sort();
  return a.every((seat, idx) => seat === b[idx]);
};

const isActiveLock = (seat, now = new Date()) => {
  if (!seat || seat.status !== "LOCKED") return false;
  if (!seat.expireAt) return true;
  return new Date(seat.expireAt) > now;
};

/** Extend lock TTL so a same-user payment retry keeps seats reserved. */
const refreshLockExpiry = async (bookingId) => {
  const expireAt = new Date(Date.now() + getLockTimeoutSeconds() * 1000);
  await seatModel.updateMany(
    { bookingId, status: "LOCKED" },
    { $set: { expireAt } }
  );
  return expireAt;
};

const isResumablePaymentStatus = (status) =>
  status === "PENDING" || status === "CREATED" || status === "FAILED";

/**
 * Build Phase 2 recovery payload when same user + same trip has:
 * PENDING booking, resumable payment, and active LOCKED seats.
 * Returns null if the booking cannot be resumed.
 */
const buildBookingRecovery = async (booking, userId) => {
  if (!booking || booking.status !== "PENDING") return null;
  if (String(booking.userId) !== String(userId)) return null;

  const order = await orderModel.findOne({ bookingId: booking._id });
  if (!order || order.status !== "PENDING") return null;

  const payment = await paymentModel.findOne({ orderId: order._id });
  if (!payment || !isResumablePaymentStatus(payment.status)) return null;

  const now = new Date();
  const locks = await seatModel.find({
    bookingId: booking._id,
    status: "LOCKED",
    userId: booking.userId,
  });

  const seatNumbers = (booking.seatsInfo || []).map((s) => s.seatNumber);
  if (!seatNumbers.length) return null;

  const ownedActiveLocks = locks.filter(
    (seat) =>
      isActiveLock(seat, now) &&
      seatNumbers.some((n) => String(n) === String(seat.seatNumber))
  );

  // Require every booked seat to still have an active lock owned by this user
  if (
    ownedActiveLocks.length !== seatNumbers.length ||
    !seatsMatchExactly(
      ownedActiveLocks.map((s) => s.seatNumber),
      seatNumbers
    )
  ) {
    return null;
  }

  // Refresh lock window for resume, then read canonical expiresAt
  const expiresAt = await refreshLockExpiry(booking._id);

  const updatedBooking = await bookingModel.findByIdAndUpdate(
    booking._id,
    { $inc: { retryCount: 1 } },
    { new: true }
  );

  const passengerDetails = (booking.seatsInfo || []).map((seat) => ({
    seatNumber: seat.seatNumber,
    name: seat.name,
    age: seat.age,
    gender: seat.gender,
    paidAmount: seat.paidAmount,
  }));

  return {
    bookingStatus: "PENDING",
    canResume: true,
    bookingId: booking._id,
    paymentId: payment._id,
    orderId: order._id,
    expiresAt,
    retryCount: updatedBooking?.retryCount ?? 1,
    seatNumbers: [...seatNumbers].sort(),
    passengerDetails,
    // Helpers for controller payment resume (not required by FE Phase 2 contract)
    _payment: payment,
    _order: order,
    _booking: updatedBooking || booking,
  };
};

/**
 * Same-user recovery: PENDING booking for this trip + seats with active locks.
 */
const findReusablePendingBooking = async (userId, tripId, seatNumbers, idempotencyKey) => {
  const userIdStr = String(userId);
  const now = new Date();

  const candidates = [];
  if (idempotencyKey) {
    const byKey = await bookingModel.findOne({
      idempotencyKey,
      userId,
      status: "PENDING",
    });
    if (byKey) candidates.push(byKey);
  }

  const pendingForTrip = await bookingModel.find({
    userId,
    tripId,
    status: "PENDING",
  });
  for (const booking of pendingForTrip) {
    if (!candidates.some((c) => String(c._id) === String(booking._id))) {
      candidates.push(booking);
    }
  }

  for (const booking of candidates) {
    const bookingSeats = (booking.seatsInfo || []).map((s) => s.seatNumber);
    if (!seatsMatchExactly(bookingSeats, seatNumbers)) continue;

    const locks = await seatModel.find({
      tripId,
      bookingId: booking._id,
      seatNumber: { $in: seatNumbers },
      status: "LOCKED",
    });

    const ownedActiveLocks = locks.filter(
      (seat) =>
        isActiveLock(seat, now) &&
        seat.userId &&
        String(seat.userId) === userIdStr
    );

    if (ownedActiveLocks.length !== seatNumbers.length) {
      // Stale PENDING without valid locks — expire so a fresh booking can proceed
      await handleBookingExpiry(booking._id);
      continue;
    }

    return booking;
  }

  return null;
};

/**
 * If this user already holds active locks on the trip (any seat set),
 * resolve that PENDING booking for recovery instead of throwing.
 */
const findPendingBookingFromOwnLocks = async (userId, tripId, locks) => {
  const bookingIds = [
    ...new Set(
      locks
        .filter((s) => s.bookingId)
        .map((s) => String(s.bookingId))
    ),
  ];

  for (const bookingId of bookingIds) {
    const booking = await bookingModel.findOne({
      _id: bookingId,
      userId,
      tripId,
      status: "PENDING",
    });
    if (booking) return booking;
  }
  return null;
};

// Seat Reservation Helper (Lock seats within session)
const reserveSeats = async (session, tripId, userId, seatsInfo, bookingId) => {
  const seatNumbers = seatsInfo.map((s) => s.seatNumber);
  const userIdStr = String(userId);
  const now = new Date();

  // Check if seats are already occupied (locked or booked)
  const existingSeats = await seatModel.find({
    tripId,
    seatNumber: { $in: seatNumbers },
  }).session(session);

  if (existingSeats.length > 0) {
    // Drop expired locks that TTL has not removed yet so this user can re-reserve
    const expiredIds = existingSeats
      .filter((seat) => seat.status === "LOCKED" && seat.expireAt && new Date(seat.expireAt) <= now)
      .map((seat) => seat._id);
    if (expiredIds.length > 0) {
      await seatModel.deleteMany({ _id: { $in: expiredIds } }).session(session);
    }

    const activeSeats = existingSeats.filter((seat) => !expiredIds.some((id) => String(id) === String(seat._id)));

    const blocking = activeSeats.filter((seat) => {
      if (seat.status === "BOOKED") return true;
      if (seat.status === "LOCKED") {
        // Same authenticated user already holding the lock — not a foreign conflict
        if (seat.userId && String(seat.userId) === userIdStr) return false;
        return true;
      }
      return true;
    });

    if (blocking.length > 0) {
      const lockedOrBookedNumbers = blocking.map((s) => s.seatNumber).join(", ");
      throw new SeatLockError(`Seat(s) ${lockedOrBookedNumbers} are already locked or booked`);
    }

    // All remaining locks belong to this user — do not insert duplicates
    const sameUserLocks = activeSeats.filter(
      (seat) =>
        seat.status === "LOCKED" &&
        seat.userId &&
        String(seat.userId) === userIdStr
    );
    if (sameUserLocks.length === seatNumbers.length) {
      return;
    }
  }

  // Create temporary Seat documents with status "LOCKED" and configurable expireAt timestamp for TTL
  const expireAt = new Date(Date.now() + getLockTimeoutSeconds() * 1000);
  const seatsToLock = seatsInfo.map((seat) => ({
    tripId,
    seatNumber: seat.seatNumber,
    status: "LOCKED",
    bookingId,
    userId,
    gender: seat.gender,
    expireAt,
  }));
  try {
    await seatModel.insertMany(seatsToLock, { session });
  } catch (error) {
    // If concurrent write conflict occurred (due to unique compound index), handle as seat already locked
    if (error.code === 11000) {
      throw new SeatLockError("One or more seats have already been locked by another user. Please choose another seat.");
    }
    throw error;
  }
};


// Commit helper for finalizing payment success state
// ONLY path that may transition seats LOCKED → BOOKED (called from /payment/verify or captured webhook).
const handlePaymentSuccess = async (bookingId, orderId, paymentId, transactionId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const booking = await bookingModel.findById(bookingId).session(session);
    if (!booking) {
      throw new BookingError("Booking not found", 404);
    }

    // Idempotent: already confirmed — BOOKED must never revert
    if (booking.status === "CONFIRMED") {
      await session.commitTransaction();
      return;
    }

    // Only PENDING bookings may be confirmed (closing Razorpay / failed pay / expiry must not confirm)
    if (booking.status !== "PENDING") {
      throw new BookingError(
        `Cannot confirm booking with status '${booking.status}'`,
        400
      );
    }

    booking.status = "CONFIRMED";
    await booking.save({ session });

    await orderModel.findByIdAndUpdate(
      orderId,
      { status: "PAID", paymentId },
      { session }
    );

    await paymentModel.findByIdAndUpdate(
      paymentId,
      { status: "SUCCESS", transactionId },
      { session }
    );

    // LOCKED → BOOKED only; unset expireAt so TTL can never delete BOOKED seats
    await seatModel.updateMany(
      { bookingId, status: "LOCKED" },
      { $set: { status: "BOOKED" }, $unset: { expireAt: "" } },
      { session }
    );

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Payment attempt failed — seats remain LOCKED until lock TTL expires (AVAILABLE).
// Does NOT confirm booking. Does NOT release seats. Does NOT revert BOOKED.
const handlePaymentFailure = async (bookingId, orderId, paymentId, errorMessage) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const booking = await bookingModel.findById(bookingId).session(session);

    // BOOKED / CONFIRMED must never revert on a late failure event
    if (booking && booking.status === "CONFIRMED") {
      await session.commitTransaction();
      return;
    }

    // Record failed payment attempt only. Booking stays PENDING; seats stay LOCKED.
    await paymentModel.findByIdAndUpdate(
      paymentId,
      { status: "FAILED", errorMessage },
      { session }
    );

    // Intentionally do NOT:
    // - set booking to FAILED / CONFIRMED
    // - delete seat locks (Payment Failed → LOCKED per state machine)
    // - change order away from PENDING (retry possible until lock expires)

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Lock expired (or stale PENDING without active locks) → booking EXPIRED, LOCKED seats freed.
// Never touches BOOKED seats.
const handleBookingExpiry = async (bookingId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const booking = await bookingModel.findById(bookingId).session(session);
    if (!booking) {
      throw new BookingError("Booking not found", 404);
    }

    // BOOKED / CONFIRMED must never revert
    if (booking.status === "CONFIRMED") {
      await session.commitTransaction();
      return;
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

      // Free only LOCKED seats → AVAILABLE. Never delete BOOKED.
      await seatModel.deleteMany(
        { bookingId: booking._id, status: "LOCKED" },
        { session }
      );
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

    // Release seats for this booking only — never delete the wrong status bucket.
    if (previousStatus === "CONFIRMED") {
      await seatModel.deleteMany(
        { bookingId: booking._id, status: "BOOKED" },
        { session }
      );
    } else {
      await seatModel.deleteMany(
        { bookingId: booking._id, status: "LOCKED" },
        { session }
      );
    }

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
      await seatModel.deleteMany(
        { bookingId: order.bookingId, status: "BOOKED" },
        { session }
      );
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
console.log("alreadyBookedSeats", alreadyBookedSeats)

  if (alreadyBookedSeats.length > 0) {
    const bookedNumbers = alreadyBookedSeats.map((s) => s.seatNumber).join(", ");
    throw new SeatLockError(`Seat(s) ${bookedNumbers} are already booked`);
  }

  // Same-user recovery: PENDING booking + active locks + resumable payment
  const reusableBooking = await findReusablePendingBooking(
    userId,
    tripId,
    seatNumbers,
    idempotencyKey
  );
  if (reusableBooking) {
    const recovery = await buildBookingRecovery(reusableBooking, userId);
    if (recovery) {
      return { isRecovery: true, recovery };
    }
    // Not resumable (e.g. stale payment) — expire and allow a fresh booking
    await handleBookingExpiry(reusableBooking._id);
  }

  // Another user (or a non-reusable lock) still holding these seats → reject
  const now = new Date();
  const foreignOrActiveLocks = await seatModel.find({
    tripId,
    seatNumber: { $in: seatNumbers },
    status: "LOCKED",
  });
  const blockingLocks = foreignOrActiveLocks.filter((seat) => {
    if (!isActiveLock(seat, now)) return false;
    return !seat.userId || String(seat.userId) !== String(userId);
  });
  if (blockingLocks.length > 0) {
    const lockedNumbers = blockingLocks.map((s) => s.seatNumber).join(", ");
    throw new SeatLockError(
      `Seat(s) ${lockedNumbers} are already locked or booked`
    );
  }

  // Own active locks → recover that PENDING booking instead of "Seat already locked"
  const ownActiveLocks = foreignOrActiveLocks.filter((seat) => {
    if (!isActiveLock(seat, now)) return false;
    return seat.userId && String(seat.userId) === String(userId);
  });
  if (ownActiveLocks.length > 0) {
    const ownPending = await findPendingBookingFromOwnLocks(
      userId,
      tripId,
      ownActiveLocks
    );
    if (ownPending) {
      const recovery = await buildBookingRecovery(ownPending, userId);
      if (recovery) {
        return { isRecovery: true, recovery };
      }
    }
    const lockedNumbers = ownActiveLocks.map((s) => s.seatNumber).join(", ");
    throw new SeatLockError(
      `Seat(s) ${lockedNumbers} are already reserved in your pending booking. Complete payment or wait for the lock to expire.`
    );
  }

  // Idempotency: confirmed booking with this key means seats are taken
  const existingBooking = await bookingModel.findOne({ idempotencyKey });
  if (existingBooking && existingBooking.status === "CONFIRMED") {
    throw new SeatLockError(`Seat(s) ${seatNumbers.join(", ")} are already booked`);
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
      retryCount: 0,
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
          const recovery = await buildBookingRecovery(existing, userId);
          if (recovery) {
            return { isRecovery: true, recovery };
          }
          return { isRecovery: false, booking: existing };
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

  return { isRecovery: false, booking };
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

/**
 * Phase 4 — Edit passenger details on a PENDING booking.
 * Editable: name, age, gender, contact phone (and email on POC).
 * Not editable: trip, seats, boarding point, dropping point.
 * Same booking + same seats; caller must create a new Razorpay order after this.
 */
const editBookingPassengers = async (bookingId, userId, updateData = {}) => {
  if (!Types.ObjectId.isValid(bookingId)) {
    throw new ValidationError("Invalid booking id");
  }

  const booking = await bookingModel.findById(bookingId);
  if (!booking) {
    throw new BookingError("Booking not found", 404);
  }
  if (String(booking.userId) !== String(userId)) {
    throw new BookingError("Unauthorized: booking does not belong to this user", 403);
  }
  if (booking.status !== "PENDING") {
    throw new BookingError(
      `Only PENDING bookings can be edited. Current status: '${booking.status}'`,
      400
    );
  }

  // Reject attempts to change trip / boarding / dropping — require a new booking
  if (
    updateData.tripId != null &&
    String(updateData.tripId) !== String(booking.tripId)
  ) {
    throw new ValidationError(
      "Trip cannot be changed on an existing booking. Please create a new booking."
    );
  }
  if (
    updateData.boardingPointId != null &&
    Number(updateData.boardingPointId) !== Number(booking.boardingPointId)
  ) {
    throw new ValidationError(
      "Boarding point cannot be changed on an existing booking. Please create a new booking."
    );
  }
  if (
    updateData.droppingPointId != null &&
    Number(updateData.droppingPointId) !== Number(booking.droppingPointId)
  ) {
    throw new ValidationError(
      "Dropping point cannot be changed on an existing booking. Please create a new booking."
    );
  }

  const { seatsInfo: incomingSeatsInfo, pocDetails } = updateData;

  // Allow POC-only updates by defaulting to existing seat passenger rows
  let seatsInfo = incomingSeatsInfo;
  if (!Array.isArray(seatsInfo) || seatsInfo.length === 0) {
    if (!pocDetails) {
      throw new ValidationError("Provide seatsInfo and/or pocDetails to update");
    }
    seatsInfo = (booking.seatsInfo || []).map((s) => ({
      seatNumber: s.seatNumber,
      name: s.name,
      age: s.age,
      gender: s.gender,
    }));
  }

  const existingSeatNumbers = (booking.seatsInfo || []).map((s) =>
    String(s.seatNumber)
  );
  const incomingSeatNumbers = seatsInfo.map((s) => String(s.seatNumber));

  // Seat set must match exactly — seat changes require a new booking
  if (!seatsMatchExactly(existingSeatNumbers, incomingSeatNumbers)) {
    throw new ValidationError(
      "Seats cannot be changed on an existing booking. Please create a new booking."
    );
  }

  for (const seat of seatsInfo) {
    if (!seat.seatNumber || !seat.name || seat.age == null || !seat.gender) {
      throw new ValidationError("Invalid passenger information");
    }
    if (!["M", "F", "O"].includes(seat.gender)) {
      throw new ValidationError("Invalid gender value");
    }
    const ageNum = Number(seat.age);
    if (!Number.isFinite(ageNum) || ageNum < 1 || ageNum > 120) {
      throw new ValidationError("Invalid passenger age");
    }
  }

  if (pocDetails) {
    if (!pocDetails.phoneNumber) {
      throw new ValidationError("Contact number is required");
    }
  }

  // Active locks must still belong to this booking / user
  const now = new Date();
  const locks = await seatModel.find({
    bookingId: booking._id,
    status: "LOCKED",
    userId: booking.userId,
  });
  const activeLocks = locks.filter((seat) => isActiveLock(seat, now));
  if (
    activeLocks.length !== existingSeatNumbers.length ||
    !seatsMatchExactly(
      activeLocks.map((s) => s.seatNumber),
      existingSeatNumbers
    )
  ) {
    throw new BookingError(
      "Seat lock is no longer active. Please create a new booking.",
      400
    );
  }

  const order = await orderModel.findOne({ bookingId: booking._id });
  if (!order || order.status !== "PENDING") {
    throw new BookingError("Order is not available for passenger edit", 400);
  }

  const payment = await paymentModel.findOne({ orderId: order._id });
  if (!payment || !isResumablePaymentStatus(payment.status)) {
    throw new BookingError("Payment is not available for passenger edit", 400);
  }

  // Apply editable fields only; preserve paidAmount and seat numbers
  const incomingBySeat = {};
  seatsInfo.forEach((s) => {
    incomingBySeat[String(s.seatNumber)] = s;
  });

  booking.seatsInfo = (booking.seatsInfo || []).map((existing) => {
    const incoming = incomingBySeat[String(existing.seatNumber)];
    return {
      seatNumber: existing.seatNumber,
      paidAmount: existing.paidAmount,
      name: String(incoming.name).trim(),
      age: Number(incoming.age),
      gender: incoming.gender,
    };
  });

  if (pocDetails) {
    booking.pocDetails = {
      phoneNumber: String(pocDetails.phoneNumber).trim(),
      email:
        pocDetails.email != null
          ? String(pocDetails.email).trim()
          : booking.pocDetails?.email,
    };
  }

  await booking.save();

  // Keep LOCKED seat gender in sync for layout occupancy display
  for (const seat of booking.seatsInfo) {
    await seatModel.updateOne(
      { bookingId: booking._id, seatNumber: seat.seatNumber, status: "LOCKED" },
      { $set: { gender: seat.gender } }
    );
  }

  const expiresAt = await refreshLockExpiry(booking._id);

  const passengerDetails = booking.seatsInfo.map((seat) => ({
    seatNumber: seat.seatNumber,
    name: seat.name,
    age: seat.age,
    gender: seat.gender,
    paidAmount: seat.paidAmount,
  }));

  return {
    bookingStatus: "PENDING",
    canResume: true,
    passengersUpdated: true,
    requireNewPaymentOrder: true,
    bookingId: booking._id,
    paymentId: payment._id,
    orderId: order._id,
    expiresAt,
    retryCount: booking.retryCount || 0,
    seatNumbers: existingSeatNumbers.sort(),
    passengerDetails,
    pocDetails: booking.pocDetails,
    _payment: payment,
    _order: order,
    _booking: booking,
  };
};

module.exports = {
  bookTrip,
  getUserBookings,
  buildBookingRecovery,
  editBookingPassengers,
  handlePaymentSuccess,
  handlePaymentFailure,
  handleBookingExpiry,
  cancelBooking,
  refundPayment,
};
