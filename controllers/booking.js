const { bookTrip, getUserBookings } = require("../services/bookingService");
const authenticateUser = require("../utils/authenticateUser");
const catchAsyncError = require("../middlewares/catchAsyncError");
const CustomError = require("../utils/createCustomError");

const router = require("express").Router();

router.post(
  "/book",
  authenticateUser,
  catchAsyncError(async (req, res) => {
    const bookedDetails = await bookTrip(req.body, req.id);
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
