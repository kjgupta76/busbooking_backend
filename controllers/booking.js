const {
  bookTrip,
  getUserBookings,
  editBookingPassengers,
} = require("../services/bookingService");
const paymentService = require("../services/paymentService");
const authenticateUser = require("../utils/authenticateUser");
const catchAsyncError = require("../middlewares/catchAsyncError");
const CustomError = require("../utils/createCustomError");
const { PaymentError, ValidationError } = CustomError;
const orderModel = require("../models/order");
const paymentModel = require("../models/payment");
const seatModel = require("../models/seat");

const router = require("express").Router();

/**
 * Ensure a gateway order exists for resume/new booking.
 * Reuses PENDING payment+gateway order unless forceNew is set (passenger edit).
 */
const ensurePaymentInitiated = async (payment, { forceNew = false } = {}) => {
  const activeGateway = (process.env.PAYMENT_GATEWAY || "MOCK_GATEWAY").trim();
  if (payment.gateway !== activeGateway) {
    await paymentModel.findByIdAndUpdate(payment._id, { gateway: activeGateway });
    payment.gateway = activeGateway;
  }

  const canReusePendingPayment =
    !forceNew &&
    payment.status === "PENDING" &&
    payment.gatewayTransactionId &&
    payment.rawResponse;

  if (canReusePendingPayment) {
    return {
      reused: true,
      razorpayOrderId: payment.gatewayTransactionId,
      updatedPayment: payment,
    };
  }

  // Clear previous gateway id so a new Razorpay order can be stored cleanly
  if (forceNew && payment.gatewayTransactionId) {
    await paymentModel.findByIdAndUpdate(payment._id, {
      $unset: {
        gatewayTransactionId: 1,
        rawResponse: 1,
        errorMessage: 1,
      },
      $set: { status: "CREATED" },
    });
  }

  const initiated = await paymentService.initiatePayment(payment._id);
  const updatedPayment = await paymentModel.findById(payment._id);
  return {
    reused: false,
    razorpayOrderId: initiated.gatewayTransactionId,
    updatedPayment,
  };
};

const passengersDiffer = (bookingSeats = [], incomingSeats = [], bookingPoc, incomingPoc) => {
  if (!incomingSeats?.length) return false;

  const bySeat = {};
  bookingSeats.forEach((s) => {
    bySeat[String(s.seatNumber)] = s;
  });

  for (const seat of incomingSeats) {
    const existing = bySeat[String(seat.seatNumber)];
    if (!existing) return true;
    if (String(existing.name).trim() !== String(seat.name || "").trim()) return true;
    if (Number(existing.age) !== Number(seat.age)) return true;
    if (String(existing.gender) !== String(seat.gender)) return true;
  }

  if (incomingPoc?.phoneNumber != null) {
    if (
      String(bookingPoc?.phoneNumber || "").trim() !==
      String(incomingPoc.phoneNumber).trim()
    ) {
      return true;
    }
  }
  if (incomingPoc?.email != null) {
    if (
      String(bookingPoc?.email || "").trim() !==
      String(incomingPoc.email).trim()
    ) {
      return true;
    }
  }

  return false;
};

const formatRecoveryResponse = async (recovery, { forceNewPayment = false } = {}) => {
  const {
    bookingStatus,
    canResume,
    bookingId,
    paymentId,
    orderId,
    expiresAt,
    retryCount,
    seatNumbers,
    passengerDetails,
    pocDetails,
    passengersUpdated,
    _payment,
    _order,
  } = recovery;

  const payment = await paymentModel.findById(_payment._id);
  const { razorpayOrderId, updatedPayment } = await ensurePaymentInitiated(payment, {
    forceNew: forceNewPayment || recovery.requireNewPaymentOrder,
  });

  return {
    success: true,
    message: passengersUpdated
      ? "Passenger details updated. Complete payment with the new order."
      : "Pending booking recovered. Resume payment to confirm.",
    bookingStatus,
    canResume,
    bookingId,
    paymentId,
    orderId,
    expiresAt,
    retryCount,
    seatNumbers,
    passengerDetails,
    pocDetails: pocDetails || recovery._booking?.pocDetails || null,
    passengersUpdated: Boolean(passengersUpdated),
    amount: _order.amount,
    currency: "INR",
    key: process.env.RAZORPAY_KEY_ID,
    razorpayOrderId,
    razorpayOrder: updatedPayment.rawResponse,
  };
};

router.post(
  "/book",
  authenticateUser,
  catchAsyncError(async (req, res) => {
    const result = await bookTrip(req.body, req.id);

    // ── Phase 2 + 4: Recovery (optionally apply passenger edits) ─────────────
    if (result.isRecovery && result.recovery) {
      let recovery = result.recovery;
      let forceNewPayment = false;

      const incomingSeats = req.body?.seatsInfo;
      const incomingPoc = req.body?.pocDetails;
      const bookingDoc = recovery._booking;

      if (
        bookingDoc &&
        passengersDiffer(
          bookingDoc.seatsInfo,
          incomingSeats,
          bookingDoc.pocDetails,
          incomingPoc
        )
      ) {
        // Phase 4: edit passengers on same booking, then force a new Razorpay order
        recovery = await editBookingPassengers(recovery.bookingId, req.id, {
          seatsInfo: incomingSeats,
          pocDetails: incomingPoc,
          tripId: req.body.tripId,
          boardingPointId: req.body.boardingPointId,
          droppingPointId: req.body.droppingPointId,
        });
        forceNewPayment = true;
      }

      return res.status(200).json(await formatRecoveryResponse(recovery, { forceNewPayment }));
    }

    // ── Fresh booking ────────────────────────────────────────────────────────
    const bookedDetails = result.booking;
    if (!bookedDetails) {
      throw new PaymentError("Booking could not be created", 500);
    }

    const order = await orderModel.findOne({ bookingId: bookedDetails._id });
    if (!order) throw new PaymentError("Order record not found after booking", 500);

    const payment = await paymentModel.findOne({ orderId: order._id });
    if (!payment) throw new PaymentError("Payment record not found after booking", 500);

    console.log("activeGateway", (process.env.PAYMENT_GATEWAY || "MOCK_GATEWAY").trim());
    console.log("payment", payment, payment.gateway);

    const { razorpayOrderId, updatedPayment } = await ensurePaymentInitiated(payment);

    const locks = await seatModel.find({
      bookingId: bookedDetails._id,
      status: "LOCKED",
    });
    const expiresAt =
      locks.reduce((earliest, seat) => {
        if (!seat.expireAt) return earliest;
        if (!earliest || seat.expireAt < earliest) return seat.expireAt;
        return earliest;
      }, null) || null;

    return res.status(200).json({
      success: true,
      message: "Booking created. Complete payment to confirm.",
      bookingStatus: "PENDING",
      canResume: false,
      bookingId: bookedDetails._id,
      orderId: order._id,
      paymentId: payment._id,
      expiresAt,
      retryCount: bookedDetails.retryCount || 0,
      seatNumbers: (bookedDetails.seatsInfo || []).map((s) => s.seatNumber).sort(),
      passengerDetails: (bookedDetails.seatsInfo || []).map((seat) => ({
        seatNumber: seat.seatNumber,
        name: seat.name,
        age: seat.age,
        gender: seat.gender,
        paidAmount: seat.paidAmount,
      })),
      pocDetails: bookedDetails.pocDetails,
      passengersUpdated: false,
      razorpayOrderId,
      amount: order.amount,
      currency: "INR",
      key: process.env.RAZORPAY_KEY_ID,
      razorpayOrder: updatedPayment.rawResponse,
    });
  })
);

/**
 * Phase 4 — Edit passenger details on a PENDING booking.
 * PATCH /booking/:bookingId/passengers
 *
 * Body: { seatsInfo: [{ seatNumber, name, age, gender }], pocDetails: { phoneNumber, email? } }
 * Not allowed: changing trip, seats, boarding, or dropping points.
 */
router.patch(
  "/:bookingId/passengers",
  authenticateUser,
  catchAsyncError(async (req, res) => {
    const { bookingId } = req.params;
    const { seatsInfo, pocDetails, tripId, boardingPointId, droppingPointId } =
      req.body || {};

    if (!seatsInfo && !pocDetails) {
      throw new ValidationError("Provide seatsInfo and/or pocDetails to update");
    }

    const recovery = await editBookingPassengers(bookingId, req.id, {
      seatsInfo,
      pocDetails,
      tripId,
      boardingPointId,
      droppingPointId,
    });

    // Always issue a new Razorpay order after passenger edit
    return res.status(200).json(
      await formatRecoveryResponse(recovery, { forceNewPayment: true })
    );
  })
);

router.get(
  "/list",
  authenticateUser,
  catchAsyncError(async (req, res) => {
    const bookings = await getUserBookings(req.id);
    return res.status(200).json({
      success: true,
      count: bookings.length,
      bookings,
    });
  })
);

module.exports = router;
