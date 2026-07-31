const tripModel = require("../models/trip.js");
const CustomError = require("./../utils/createCustomError.js");
const cityModel = require("../models/city.js");
const busModel = require("../models/bus.js");
const seatModel = require("../models/seat.js");
const { Types } = require("mongoose");

const getAvailableSeats = (bus, tripId, occupiedSeats) => {
  const upperDeckCount = bus.layout?.upperDeck?.length || 0;
  const lowerDeckCount = bus.layout?.lowerDeck?.length || 0;
  const totalSeats = upperDeckCount + lowerDeckCount;

  const tripOccupiedCount = occupiedSeats.filter(
    (seat) => seat.tripId.toString() === tripId.toString()
  ).length;

  return totalSeats - tripOccupiedCount;
};

const getTrips = async (query) => {
  let { sourceCityId, destinationCityId, travelDate } = query;

  const travelDateNum = Number(travelDate);
  if (!travelDate || Number.isNaN(travelDateNum)) {
    throw new CustomError("Invalid Date", 400);
  }

  // travelDate is start-of-day in the user's timezone (unix seconds).
  // Compare against a rolling window so UTC server time does not reject valid local dates.
  const now = Math.floor(Date.now() / 1000);
  const dayEnd = travelDateNum + 86400 - 1;

  if (dayEnd < now - 86400) {
    throw new CustomError("Invalid Date", 400);
  }

  let searchFilter = {};

  if (travelDateNum <= now && now <= dayEnd) {
    searchFilter["startTime"] = {
      $gte: now,
      $lte: dayEnd,
    };
  } else {
    searchFilter["startTime"] = {
      $gte: travelDateNum,
      $lte: dayEnd,
    };
  }

  searchFilter.source = new Types.ObjectId(sourceCityId);
  searchFilter.destination = new Types.ObjectId(destinationCityId);

  const sourceCity = await cityModel.findById(sourceCityId);
  const destinationCity = await cityModel.findById(destinationCityId);

  // checking if city is present in database
  if (!sourceCity || !destinationCity) {
    throw new CustomError("Requested City not Found", 404);
  }

  const tripFilterOjb = {
    _id: 1,
    startTime: 1,
    endTime: 1,
    prices: 1,
    boardingPoints: 1,
    droppingPoints: 1,
  };
  const trips = await tripModel
    .find(searchFilter, tripFilterOjb)
    .populate("busId", "_id busPartner amenities layout busType");
  const tripIds = trips.map((item) => item._id);

  let occupiedSeats = [];
  if (tripIds.length > 0) {
    occupiedSeats = await seatModel.find({ tripId: { $in: tripIds } });
  }
  const response = {};
  response.success = true;
  response.results = trips.length;
  response.boardingPoints = sourceCity?.stopPoints;
  response.dropingPoints = destinationCity?.stopPoints;
  response.trips = [];
  for (let trip of trips) {
    const bus = trip.busId;
    let minPrice = Number.MAX_SAFE_INTEGER,
      maxPrice = 0;
    trip.prices.forEach((seatPrice) => {
      if (minPrice > seatPrice.price) minPrice = seatPrice.price;
      if (maxPrice < seatPrice.price) maxPrice = seatPrice.price;
    });
    response.trips.push({
      busId: bus._id,
      tripId: trip._id,
      busPartner: bus.busPartner,
      departureTime: trip.startTime,
      arrivalTime: trip.endTime,
      amenities: bus.amenities,
      availableSeats: getAvailableSeats(bus, trip._id, occupiedSeats),
      busType: bus.busType,
      minPrice,
      maxPrice,
      boardingPoints: trip.boardingPoints,
      droppingPoints: trip.droppingPoints,
    });
  }

  return response;
};

module.exports = getTrips;
