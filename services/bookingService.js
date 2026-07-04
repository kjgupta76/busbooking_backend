const { bookingModel } = require("../models/booking");
const tripModel = require("../models/trip");
const { Types } = require("mongoose");
const CustomError = require("../utils/createCustomError");

const bookTrip = async (bookingData, userId) => {
  const { tripId, boardingPointId, droppingPointId, seatsInfo, pocDetails } =
    bookingData;

  if (
    !tripId ||
    boardingPointId == null ||
    droppingPointId == null ||
    !seatsInfo ||
    !pocDetails
  ) {
    throw new CustomError("Booking details missing", 400);
  }

  if (!Array.isArray(seatsInfo) || seatsInfo.length === 0) {
    throw new CustomError("Seats information is required", 400);
  }

  for (const seat of seatsInfo) {
    if (!seat.seatNumber || !seat.name || seat.age == null || !seat.gender) {
      throw new CustomError("Invalid seat information", 400);
    }
    if (!["M", "F", "O"].includes(seat.gender)) {
      throw new CustomError("Invalid gender value", 400);
    }
  }

  if (!pocDetails.phoneNumber || !pocDetails.email) {
    throw new CustomError("Invalid point of contact details", 400);
  }

  if (!Types.ObjectId.isValid(tripId)) {
    throw new CustomError("Invalid trip id", 400);
  }

  const trip = await tripModel.findById(tripId);
  if (!trip) {
    throw new CustomError("Trip not found", 404);
  }

  const existingBookings = await bookingModel.find({ tripId });
  const bookedSeats = new Set();
  existingBookings.forEach((booking) => {
    booking.seatsInfo.forEach((seat) => bookedSeats.add(seat.seatNumber));
  });

  for (const seat of seatsInfo) {
    if (bookedSeats.has(seat.seatNumber)) {
      throw new CustomError(`Seat ${seat.seatNumber} is already booked`, 400);
    }
  }

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

  const newBooking = await bookingModel.create({
    tripId,
    userId,
    bookingTime: Math.floor(Date.now() / 1000),
    seatsInfo: seatsWithPrice,
    pocDetails,
    boardingPointId: Number(boardingPointId),
    droppingPointId: Number(droppingPointId),
  });

  return newBooking;
};

const getUserBookings = async (userId) => {
  if (!Types.ObjectId.isValid(userId)) {
    return [];
  }

  const bookings = await bookingModel
    .find({ userId })
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

module.exports = { bookTrip, getUserBookings };
