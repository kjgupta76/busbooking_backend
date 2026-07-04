const tripModel = require("../models/trip.js");
const { bookingModel } = require("../models/booking.js");
const CustomError = require("../utils/createCustomError.js");
const { Types } = require("mongoose");

const formatDeckSeats = (deckSeats = [], priceMap, bookedSeatMap) => {
  return deckSeats.map((seat) => ({
    seatNumber: seat.seatNumber,
    gender: bookedSeatMap[seat.seatNumber] ?? null,
    row: seat.row,
    column: seat.column,
    price: priceMap[seat.seatNumber] ?? 0,
  }));
};

const getSeatLayout = async (query) => {
  const tripId = query.tripId;

  if (!tripId || !Types.ObjectId.isValid(tripId)) {
    throw new CustomError("Please provide a valid tripId", 400);
  }

  const trip = await tripModel.findById(tripId).populate("busId", "layout");

  if (!trip) {
    throw new CustomError(`No Trip Found for the tripId ${tripId}`, 404);
  }

  if (!trip.busId) {
    throw new CustomError("Bus not found for this trip", 404);
  }

  const upperDeckSeats = trip.busId.layout?.upperDeck ?? [];
  const lowerDeckSeats = trip.busId.layout?.lowerDeck ?? [];
  const totalSeats = upperDeckSeats.length + lowerDeckSeats.length;

  if (!totalSeats) {
    throw new CustomError("Seat layout not available for this trip", 400);
  }

  const bookings = await bookingModel.find({ tripId });
  const bookedSeatMap = {};

  bookings.forEach((booking) => {
    (booking.seatsInfo || []).forEach((seat) => {
      bookedSeatMap[seat.seatNumber] = seat.gender;
    });
  });

  const priceMap = {};
  (trip.prices || []).forEach((seatPrice) => {
    priceMap[seatPrice.seatNumber] = seatPrice.price;
  });

  return {
    upperDeck: {
      seats: formatDeckSeats(upperDeckSeats, priceMap, bookedSeatMap),
    },
    lowerDeck: {
      seats: formatDeckSeats(lowerDeckSeats, priceMap, bookedSeatMap),
    },
  };
};

module.exports = { getSeatLayout };
