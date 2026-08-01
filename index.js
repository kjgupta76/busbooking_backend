const express = require("express");
const app = express();
const path = require("path");
require("dotenv").config();

// ─── Payment Providers ──────────────────────────────────────────────────────────
// Load RazorpayProvider so it self-registers into the Strategy Pattern gateway
// registry at startup. Guard prevents a crash if placeholder keys are still set.


if (
  process.env.RAZORPAY_KEY_ID &&
  process.env.RAZORPAY_KEY_ID.startsWith("rzp_")
) {
  require("./services/razorpayProvider");
} else {
  console.log(
    "[RazorpayProvider] Skipped: RAZORPAY_KEY_ID not configured. Using MOCK_GATEWAY."
  );
}

const cors = require("cors");
const globalErrorHandler = require("./middlewares/globalErrorHandler");
const cityRouter = require("./controllers/city");
const tripRouter = require("./controllers/trip.js");
const signUpRouter = require("./controllers/signUp");
const loginRouter = require("./controllers/login");
const bookingRouter = require("./controllers/booking");
const paymentRouter = require("./controllers/payment");
const seatRouter = require("./controllers/seat.js");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const userModel = require("./models/user");
const seatModel = require("./models/seat");


const dropStaleUserIndexes = async () => {
  const indexes = await userModel.collection.indexes();
  const staleIndex = indexes.find((index) => index.name === "fullName_1");

  if (staleIndex) {
    await userModel.collection.dropIndex("fullName_1");
    console.log("Dropped stale unique index on users.fullName");
  }
};

/**
 * Ensure seat TTL only applies to LOCKED seats.
 * Drops the legacy unrestricted expireAt TTL index if present, then syncs schema indexes.
 */
const ensureSeatLockTtlIndex = async () => {
  const indexes = await seatModel.collection.indexes();
  const legacyTtl = indexes.find(
    (index) =>
      index.name === "expireAt_1" &&
      index.expireAfterSeconds === 0 &&
      !index.partialFilterExpression
  );

  if (legacyTtl) {
    await seatModel.collection.dropIndex("expireAt_1");
    console.log("Dropped legacy seat expireAt TTL index (was not LOCKED-only)");
  }

  await seatModel.syncIndexes();
  console.log("Seat indexes synced (locked_seat_ttl active)");
};

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); },
}));
app.use(express.urlencoded({ extended: true }));
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("connected successfully");
    try {
      await dropStaleUserIndexes();
    } catch (error) {
      console.warn("User index cleanup or migration skipped:", error.message);
    }
    try {
      await ensureSeatLockTtlIndex();
    } catch (error) {
      console.warn("Seat TTL index migration skipped:", error.message);
    }
  });
app.use(cors());

app.use(cookieParser());

app.use("/city", cityRouter);
app.use("/api/trips", tripRouter);
app.use("/api/seat", seatRouter);
app.use("/register", signUpRouter);
app.use("/auth", loginRouter);
app.use("/booking", bookingRouter);
app.use("/payment", paymentRouter);

const PORT = process.env.PORT || 8080;
const MODE = process.env.NODE_ENV || "production";

app.use(globalErrorHandler);

app.listen(PORT, () => {
  console.log(`App is running at ${PORT} in ${MODE} mode`);
});
