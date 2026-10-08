// Parking configuration: hourly rates (Rs) and number of slots per vehicle type.
// Slots are created in MongoDB automatically the first time the server runs.
// To add more slots later, increase a count here and restart the server.
module.exports = {
  rates: { bike: 10, car: 20, heavy: 40 },
  slotCounts: { bike: 15, car: 20, heavy: 5 }
};
