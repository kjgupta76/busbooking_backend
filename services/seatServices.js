const tripModel = require("../models/trip.js");
const seatModel = require("../models/seat.js");
const CustomError = require("../utils/createCustomError.js");
const { Types } = require("mongoose");

const formatDeckSeats = (deckSeats = [], priceMap, bookedSeatMap) => {
  return deckSeats.map((seat) => {
    const occupancy = bookedSeatMap[seat.seatNumber];
    return {
      seatNumber: seat.seatNumber,
      gender: occupancy ? occupancy.gender : null,
      status: occupancy ? occupancy.status : "AVAILABLE",
      row: seat.row,
      column: seat.column,
      price: priceMap[seat.seatNumber] ?? 0,
    };
  });
};

const getSeatLayout = async (query) => {
  const tripId = query.tripId;
  console.log("tripId", tripId);
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

  const occupiedSeats = await seatModel.find({ tripId });

  console.log("occupiedSeats", occupiedSeats);
  const bookedSeatMap = {};

  occupiedSeats.forEach((seat) => {
    bookedSeatMap[seat.seatNumber] = {
      gender: seat.gender || "M",
      status: seat.status || "LOCKED",
    };
  });
  console.log("bookedSeatMap", bookedSeatMap);

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
