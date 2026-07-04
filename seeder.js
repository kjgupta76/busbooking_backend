// // const dotenv = require("dotenv");
// // const mongoose = require("mongoose");
// // const colors = require("colors");
// // dotenv.config();

// // //data
// // const UserData = require("./data/user.js");
// // const BusData = require("./data/bus.js");
// // const BookingsData = require("./data/booking.js");
// // const CityData = require("./data/city.js");
// // const TripData = require("./data/trip.js");

// // //models
// // const User = require("./models/user.js");
// // const Bus = require("./models/bus.js");
// // const Bookings = require("./models/booking.js");
// // const City = require("./models/city.js");
// // const Trip = require("./models/trip.js");

// // mongoose
// //   .connect(process.env.MONGO_URI)
// //   .then(() => console.log("connect successfully"))
// //   .catch(console.log);

// // console.log("Seeder is running");

// // const importData = async () => {
// //   try {
// //     await User.deleteMany();
// //     // await Bus.deleteMany();

// //     await City.deleteMany();
// //     // delete data old
// //     await Trip.deleteMany();
// //     //inseting
// //     let createdCity = false;
// //     const createdUsers = await User.insertMany(UserData);
// //     // const createdBuses = await Bus.insertMany(BusData);
// //     const createdBuses = await Bus.find({});
// //     createdCity = await City.insertMany(CityData);
// //     const busIds = createdBuses.map((bus) => bus._id);
// //     // const cities = await City.find({});
// //     const cityIds = createdCity
// //       ? createdCity.map((city) => city._id)
// //       : cities.map((city) => city._id);

// //     let tripData = Array.from({ length: 100000 }, () => TripData[0]);

// //     const sampleTrip = getFormatedTripData(
// //       tripData,
// //       createdBuses,
// //       createdCity ? createdCity : cities,
// //       cityIds,
// //       busIds
// //     );
// //     // console.log(sampleTrip);
// //     // for (let i = 0; i < sampleTrip.length; i++) {
// //     //   await Trip.create(sampleTrip[i]);
// //     //   console.log("Trip-inserted", i + 1);
// //     // }
// //     await Trip.insertMany(sampleTrip);
// //     console.log("Data Inserted".green.inverse);
// //     process.exit();
// //   } catch (error) {
// //     console.error(`error : ${error}`.red.inverse);
// //     process.exit(1);
// //   }
// // };

// // const getFormatedTripData = (
// //   TripData,
// //   createdBuses,
// //   createdCity,
// //   cityIds,
// //   busIds
// // ) => {
// //   let cityIdCount = 0;
// //   let busidCount = 0;
// //   const currentTime = parseInt(Date.now() / 1000);
// //   return TripData.map((trip, i) => {
// //     let boardingPoints = [];
// //     let droppingPoints = [];
// //     const startT = currentTime + i * 8 * 60;

// //     const endT = startT + (Math.floor(Math.random() * 10) + 1) * 60 * 60;

// //     trip.droppingPoints.forEach((p, idx) => {
// //       const obj = {
// //         arrivalTime: endT - (trip.droppingPoints.length - i * 60),
// //         stopId: createdCity[cityIdCount + 1].stopPoints[idx].stopId,
// //       };
// //       droppingPoints.push(obj);
// //     });
// //     trip.boardingPoints.forEach((p, idx) => {
// //       const obj = {
// //         arrivalTime: startT + i * 60,
// //         stopId: createdCity[cityIdCount].stopPoints[idx].stopId,
// //       };
// //       boardingPoints.push(obj);
// //     });

// //     let p = [500, 800, 1300, 1900];
// //     let prices = [];
// //     createdBuses[busidCount].layout?.upperDeck?.forEach((seat) => {
// //       prices.push({
// //         seatNumber: seat.seatNumber,
// //         price: p[Math.floor(Math.random() * 4)],
// //       });
// //     });
// //     createdBuses[busidCount].layout?.lowerDeck?.forEach((seat) => {
// //       prices.push({
// //         seatNumber: seat.seatNumber,
// //         price: p[Math.floor(Math.random() * 4)],
// //       });
// //     });

// //     trip.startTime = startT;
// //     trip.endTime = endT;
// //     const obj = {
// //       ...trip,
// //       source: cityIds[cityIdCount],
// //       destination: cityIds[cityIdCount + 1],
// //       busId: busIds[busidCount],
// //       boardingPoints,
// //       droppingPoints,
// //       prices,
// //     };
// //     cityIdCount++;
// //     busidCount++;
// //     if (cityIdCount === cityIds.length - 1) cityIdCount = 0;
// //     if (busidCount === busIds.length) busidCount = 0;
// //     return obj;
// //   });
// // };

// // const deleteData = async () => {
// //   try {
// //     await User.deleteMany();
// //     await Bus.deleteMany();
// //     await City.deleteMany();
// //     await Trip.deleteMany();
// //     console.error(`Data Deleted`.red.inverse);

// //     process.exit();
// //   } catch (error) {
// //     console.error(`error : ${error}`.red.inverse);
// //     process.exit(1);
// //   }
// // };

// // if (process.argv[2] === "-d") {
// //   deleteData();
// // } else {
// //   importData();
// // }


// const dotenv = require("dotenv");
// const mongoose = require("mongoose");
// const colors = require("colors");
// dotenv.config();

// const UserData = require("./data/user.js");
// const BusData = require("./data/bus.js");
// const CityData = require("./data/city.js");
// const TripData = require("./data/trip.js");

// const User = require("./models/user.js");
// const Bus = require("./models/bus.js");
// const City = require("./models/city.js");
// const Trip = require("./models/trip.js");

// const SEED_DAYS = 60;
// const TRIPS_PER_ROUTE = 5;
// const PRICE_CYCLE_DAYS = 3;

// // Covers all departure-time filters: morning, afternoon, evening, night
// const TRIP_SLOTS = [
//   { hour: 7, minute: 0, busIndex: 0 },
//   { hour: 11, minute: 30, busIndex: 2 },
//   { hour: 14, minute: 0, busIndex: 3 },
//   { hour: 18, minute: 30, busIndex: 1 },
//   { hour: 23, minute: 15, busIndex: 4 },
// ];

// const PRICE_TIERS = [
//   [500, 700, 900, 1100],
//   [900, 1200, 1500, 1800],
//   [1500, 2000, 2500, 3000],
//   [2500, 3000, 3500, 4000],
// ];

// const DRIVERS = [
//   { name: "John Doe", contactNumber: "1234567890" },
//   { name: "Raj Kumar", contactNumber: "9876543210" },
//   { name: "Suresh Patil", contactNumber: "8765432109" },
//   { name: "Amit Singh", contactNumber: "7654321098" },
//   { name: "Vikram Reddy", contactNumber: "6543210987" },
// ];

// mongoose
//   .connect(process.env.MONGO_URI)
//   .then(() => console.log("connect successfully"))
//   .catch(console.log);

// console.log("Seeder is running");

// const getDayStartEpoch = (dayOffset) => {
//   const date = new Date();
//   date.setHours(0, 0, 0, 0);
//   date.setDate(date.getDate() + dayOffset);
//   return Math.floor(date.getTime() / 1000);
// };

// const getCityPairs = (cityCount) => {
//   const pairs = [];
//   for (let sourceIdx = 0; sourceIdx < cityCount; sourceIdx++) {
//     for (let destIdx = 0; destIdx < cityCount; destIdx++) {
//       if (sourceIdx !== destIdx) {
//         pairs.push({ sourceIdx, destIdx });
//       }
//     }
//   }
//   return pairs;
// };

// const buildStopPoints = (city, count, baseTime, isBoarding, slotIndex) => {
//   const points = [];
//   for (let i = 0; i < count; i++) {
//     const stopIdx = (slotIndex + i) % city.stopPoints.length;
//     const offsetMinutes = (20 + i * 25) * 60;
//     points.push({
//       stopId: city.stopPoints[stopIdx].stopId,
//       arrivalTime: isBoarding ? baseTime + offsetMinutes : baseTime - offsetMinutes,
//     });
//   }
//   return points;
// };

// const getPriceValuesForTrip = (dayOffset, sourceIdx, destIdx, slotIndex) => {
//   const tierIndex =
//     (Math.floor(dayOffset / PRICE_CYCLE_DAYS) +
//       sourceIdx +
//       destIdx +
//       slotIndex) %
//     PRICE_TIERS.length;
//   const routeBonus = (sourceIdx + destIdx + 1) * 120;
//   const slotBonus = slotIndex * 200;
//   const dayBonus = (dayOffset % 4) * 50;

//   return PRICE_TIERS[tierIndex].map(
//     (price, idx) => price + routeBonus + slotBonus + dayBonus + idx * 75
//   );
// };

// const buildPrices = (bus, priceValues) => {
//   const prices = [];
//   let seatCounter = 0;

//   bus.layout?.upperDeck?.forEach((seat) => {
//     prices.push({
//       seatNumber: seat.seatNumber,
//       price: priceValues[seatCounter % priceValues.length],
//     });
//     seatCounter++;
//   });

//   bus.layout?.lowerDeck?.forEach((seat) => {
//     prices.push({
//       seatNumber: seat.seatNumber,
//       price: priceValues[seatCounter % priceValues.length],
//     });
//     seatCounter++;
//   });

//   return prices;
// };

// const generateTrips = (tripTemplate, createdBuses, createdCity) => {
//   const cityPairs = getCityPairs(createdCity.length);
//   const trips = [];
//   let tripCounter = 0;

//   for (let dayOffset = 0; dayOffset < SEED_DAYS; dayOffset++) {
//     const dayStart = getDayStartEpoch(dayOffset);

//     for (const { sourceIdx, destIdx } of cityPairs) {
//       const sourceCity = createdCity[sourceIdx];
//       const destCity = createdCity[destIdx];

//       TRIP_SLOTS.forEach((slot, slotIndex) => {
//         const startT = dayStart + slot.hour * 3600 + slot.minute * 60;
//         const durationHours = 8 + ((sourceIdx + destIdx + slotIndex) % 5);
//         const endT = startT + durationHours * 3600;
//         const bus = createdBuses[slot.busIndex];

//         const boardingPoints = buildStopPoints(
//           sourceCity,
//           tripTemplate.boardingPoints.length,
//           startT,
//           true,
//           slotIndex
//         );
//         const droppingPoints = buildStopPoints(
//           destCity,
//           tripTemplate.droppingPoints.length,
//           endT,
//           false,
//           slotIndex
//         );

//         const priceValues = getPriceValuesForTrip(
//           dayOffset,
//           sourceIdx,
//           destIdx,
//           slotIndex
//         );

//         trips.push({
//           source: sourceCity._id,
//           destination: destCity._id,
//           busId: bus._id,
//           boardingPoints,
//           droppingPoints,
//           prices: buildPrices(bus, priceValues),
//           startTime: startT,
//           endTime: endT,
//           driverDetails: DRIVERS[tripCounter % DRIVERS.length],
//         });

//         tripCounter++;
//       });
//     }
//   }

//   return trips;
// };

// const importData = async () => {
//   try {
//     await User.deleteMany();
//     await Bus.deleteMany();
//     await City.deleteMany();
//     await Trip.deleteMany();

//     await User.insertMany(UserData);
//     const createdBuses = await Bus.insertMany(BusData);
//     const createdCity = await City.insertMany(CityData);

//     const tripTemplate = TripData[0];
//     const sampleTrip = generateTrips(tripTemplate, createdBuses, createdCity);

//     await Trip.insertMany(sampleTrip);

//     const routesPerDay = getCityPairs(createdCity.length).length;
//     console.log(
//       `Data Inserted: ${sampleTrip.length} trips | ${SEED_DAYS} days | ${routesPerDay} routes/day | ${TRIPS_PER_ROUTE} trips/route`.green
//         .inverse
//     );
//     process.exit();
//   } catch (error) {
//     console.error(`error : ${error}`.red.inverse);
//     process.exit(1);
//   }
// };

// const deleteData = async () => {
//   try {
//     await User.deleteMany();
//     await Bus.deleteMany();
//     await City.deleteMany();
//     await Trip.deleteMany();
//     console.error(`Data Deleted`.red.inverse);
//     process.exit();
//   } catch (error) {
//     console.error(`error : ${error}`.red.inverse);
//     process.exit(1);
//   }
// };

// if (process.argv[2] === "-d") {
//   deleteData();
// } else {
//   importData();
// }


const dotenv = require("dotenv");
const mongoose = require("mongoose");
const colors = require("colors");
dotenv.config();

const UserData = require("./data/user.js");
const BusData = require("./data/bus.js");
const CityData = require("./data/city.js");
const TripData = require("./data/trip.js");

const User = require("./models/user.js");
const Bus = require("./models/bus.js");
const City = require("./models/city.js");
const Trip = require("./models/trip.js");

const SEED_DAYS = 60;
const TRIPS_PER_ROUTE = 5;
const PRICE_CYCLE_DAYS = 3;

// Covers all departure-time filters: morning, afternoon, evening, night
const TRIP_SLOTS = [
  { hour: 7, minute: 0, busIndex: 0 },
  { hour: 11, minute: 30, busIndex: 2 },
  { hour: 14, minute: 0, busIndex: 3 },
  { hour: 18, minute: 30, busIndex: 1 },
  { hour: 23, minute: 15, busIndex: 4 },
];

const PRICE_TIERS = [
  [500, 700, 900, 1100],
  [900, 1200, 1500, 1800],
  [1500, 2000, 2500, 3000],
  [2500, 3000, 3500, 4000],
];

const DRIVERS = [
  { name: "John Doe", contactNumber: "1234567890" },
  { name: "Raj Kumar", contactNumber: "9876543210" },
  { name: "Suresh Patil", contactNumber: "8765432109" },
  { name: "Amit Singh", contactNumber: "7654321098" },
  { name: "Vikram Reddy", contactNumber: "6543210987" },
];

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("connect successfully"))
  .catch(console.log);

console.log("Seeder is running");

const getDayStartEpoch = (dayOffset) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return Math.floor(date.getTime() / 1000);
};

const getCityPairs = (cityCount) => {
  const pairs = [];
  for (let sourceIdx = 0; sourceIdx < cityCount; sourceIdx++) {
    for (let destIdx = 0; destIdx < cityCount; destIdx++) {
      if (sourceIdx !== destIdx) {
        pairs.push({ sourceIdx, destIdx });
      }
    }
  }
  return pairs;
};

const buildStopPoints = (city, count, baseTime, isBoarding, slotIndex) => {
  const points = [];
  for (let i = 0; i < count; i++) {
    const stopIdx = (slotIndex + i) % city.stopPoints.length;
    const offsetMinutes = (20 + i * 25) * 60;
    points.push({
      stopId: city.stopPoints[stopIdx].stopId,
      arrivalTime: isBoarding ? baseTime + offsetMinutes : baseTime - offsetMinutes,
    });
  }
  return points;
};

const getPriceValuesForTrip = (dayOffset, sourceIdx, destIdx, slotIndex) => {
  const tierIndex =
    (Math.floor(dayOffset / PRICE_CYCLE_DAYS) +
      sourceIdx +
      destIdx +
      slotIndex) %
    PRICE_TIERS.length;
  const routeBonus = (sourceIdx + destIdx + 1) * 120;
  const slotBonus = slotIndex * 200;
  const dayBonus = (dayOffset % 4) * 50;

  return PRICE_TIERS[tierIndex].map(
    (price, idx) => price + routeBonus + slotBonus + dayBonus + idx * 75
  );
};

const buildPrices = (bus, priceValues) => {
  const prices = [];
  let seatCounter = 0;

  bus.layout?.upperDeck?.forEach((seat) => {
    prices.push({
      seatNumber: seat.seatNumber,
      price: priceValues[seatCounter % priceValues.length],
    });
    seatCounter++;
  });

  bus.layout?.lowerDeck?.forEach((seat) => {
    prices.push({
      seatNumber: seat.seatNumber,
      price: priceValues[seatCounter % priceValues.length],
    });
    seatCounter++;
  });

  return prices;
};

const generateTrips = (tripTemplate, createdBuses, createdCity) => {
  const cityPairs = getCityPairs(createdCity.length);
  const trips = [];
  let tripCounter = 0;

  for (let dayOffset = 0; dayOffset < SEED_DAYS; dayOffset++) {
    const dayStart = getDayStartEpoch(dayOffset);

    for (const { sourceIdx, destIdx } of cityPairs) {
      const sourceCity = createdCity[sourceIdx];
      const destCity = createdCity[destIdx];

      TRIP_SLOTS.forEach((slot, slotIndex) => {
        const startT = dayStart + slot.hour * 3600 + slot.minute * 60;
        const durationHours = 8 + ((sourceIdx + destIdx + slotIndex) % 5);
        const endT = startT + durationHours * 3600;
        const bus = createdBuses[slot.busIndex];

        const boardingPoints = buildStopPoints(
          sourceCity,
          tripTemplate.boardingPoints.length,
          startT,
          true,
          slotIndex
        );
        const droppingPoints = buildStopPoints(
          destCity,
          tripTemplate.droppingPoints.length,
          endT,
          false,
          slotIndex
        );

        const priceValues = getPriceValuesForTrip(
          dayOffset,
          sourceIdx,
          destIdx,
          slotIndex
        );

        trips.push({
          source: sourceCity._id,
          destination: destCity._id,
          busId: bus._id,
          boardingPoints,
          droppingPoints,
          prices: buildPrices(bus, priceValues),
          startTime: startT,
          endTime: endT,
          driverDetails: DRIVERS[tripCounter % DRIVERS.length],
        });

        tripCounter++;
      });
    }
  }

  return trips;
};

const importData = async () => {
  try {
    await User.deleteMany();
    await Bus.deleteMany();
    await City.deleteMany();
    await Trip.deleteMany();

    await User.insertMany(UserData);
    const createdBuses = await Bus.insertMany(BusData);
    const createdCity = await City.insertMany(CityData);

    const tripTemplate = TripData[0];
    const sampleTrip = generateTrips(tripTemplate, createdBuses, createdCity);

    await Trip.insertMany(sampleTrip);

    const routesPerDay = getCityPairs(createdCity.length).length;
    console.log(
      `Data Inserted: ${sampleTrip.length} trips | ${SEED_DAYS} days | ${routesPerDay} routes/day | ${TRIPS_PER_ROUTE} trips/route`.green
        .inverse
    );
    process.exit();
  } catch (error) {
    console.error(`error : ${error}`.red.inverse);
    process.exit(1);
  }
};

const deleteData = async () => {
  try {
    await User.deleteMany();
    await Bus.deleteMany();
    await City.deleteMany();
    await Trip.deleteMany();
    console.error(`Data Deleted`.red.inverse);
    process.exit();
  } catch (error) {
    console.error(`error : ${error}`.red.inverse);
    process.exit(1);
  }
};

if (process.argv[2] === "-d") {
  deleteData();
} else {
  importData();
}
