const express = require("express");
const app = express();
const path = require("path");
require("dotenv").config();
const cors = require("cors");
const globalErrorHandler = require("./middlewares/globalErrorHandler");
const cityRouter = require("./controllers/city");
const tripRouter = require("./controllers/trip.js");
const signUpRouter = require("./controllers/signUp");
const loginRouter = require("./controllers/login");
const bookingRouter = require("./controllers/booking");
const seatRouter = require("./controllers/seat.js");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const userModel = require("./models/user");

const dropStaleUserIndexes = async () => {
  const indexes = await userModel.collection.indexes();
  const staleIndex = indexes.find((index) => index.name === "fullName_1");

  if (staleIndex) {
    await userModel.collection.dropIndex("fullName_1");
    console.log("Dropped stale unique index on users.fullName");
  }
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("connected successfully");
    try {
      await dropStaleUserIndexes();
    } catch (error) {
      console.warn("User index cleanup skipped:", error.message);
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

const PORT = process.env.PORT || 8080;
const MODE = process.env.NODE_ENV || "production";

// if (MODE === "production") {
//   app.use(express.static(path.resolve("public")));
//   app.get("*", (req, res) => {
//     res.sendFile(path.resolve("public", "index.html"));
//   });
// } else {
//   app.get("/", (req, res) => {
//     res.status(200).send("server is running");
//   });
// }

app.use(globalErrorHandler);

app.listen(PORT, () => {
  console.log(`App is running at ${PORT} in ${MODE} mode`);
});
