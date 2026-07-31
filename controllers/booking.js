const { bookTrip, getUserBookings, handlePaymentSuccess } = require("../services/bookingService");
const authenticateUser = require("../utils/authenticateUser");
const catchAsyncError = require("../middlewares/catchAsyncError");
const CustomError = require("../utils/createCustomError");
const orderModel = require("../models/order");
const paymentModel = require("../models/payment");

const router = require("express").Router();

router.post(
  "/book",
  authenticateUser,
  catchAsyncError(async (req, res) => {
    console.log("hello working")
    const bookedDetails = await bookTrip(req.body, req.id);
    console.log("bookedDetails", bookedDetails);
    // Automatically confirm the booking for the frontend flow where there is no payment step
    try {
      const order = await orderModel.findOne({ bookingId: bookedDetails._id });
      if (order) {
        const payment = await paymentModel.findOne({ orderId: order._id });
        if (payment) {
          const transactionId = "TXN_" + Math.random().toString(36).substring(2, 9).toUpperCase();
          await handlePaymentSuccess(bookedDetails._id, order._id, payment._id, transactionId);
        }
      }
    } catch (confirmError) {
      console.error("Auto-confirmation failed:", confirmError);
      // We don't fail the request since the PENDING booking was successfully created,
      // but logging the error helps in debugging.
    }

    return res.status(200).json({
      success: true,
      message: "Booking Successful",
      bookedDetails,
    });
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
