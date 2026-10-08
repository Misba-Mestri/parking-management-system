// Mongoose models: User (student), Slot, Vehicle.
const mongoose = require("mongoose");
const { Schema } = mongoose;

// Expose "_id" as "id" in JSON so the frontend keeps working unchanged.
function toJSONOptions() {
  return {
    virtuals: false,
    versionKey: false,
    transform(doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      return ret;
    }
  };
}

const userSchema = new Schema(
  {
    role: { type: String, enum: ["student"], default: "student" },
    fullName: { type: String, required: true, trim: true },
    studentId: { type: String, required: true, unique: true, uppercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    salt: { type: String, required: true },
    passwordHash: { type: String, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// The slot's _id is its label, e.g. "C01"
const slotSchema = new Schema({
  _id: { type: String },
  type: { type: String, enum: ["bike", "car", "heavy"], required: true },
  occupied: { type: Boolean, default: false },
  vehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle", default: null }
});
slotSchema.set("toJSON", toJSONOptions());

const vehicleSchema = new Schema({
  vehicleNumber: { type: String, required: true, uppercase: true, trim: true },
  type: { type: String, enum: ["bike", "car", "heavy"], required: true },
  ownerName: { type: String, required: true, trim: true },
  phone: { type: String, default: "" },
  slotId: { type: String, required: true },
  entryTime: { type: Date, default: Date.now },
  exitTime: { type: Date, default: null },
  durationMinutes: { type: Number, default: null },
  fee: { type: Number, default: null },
  status: { type: String, enum: ["parked", "exited"], default: "parked" }
});
vehicleSchema.index({ entryTime: -1 });
// A plate number can only be "parked" once at a time (also protects against double-clicks)
vehicleSchema.index(
  { vehicleNumber: 1 },
  { unique: true, partialFilterExpression: { status: "parked" } }
);
vehicleSchema.set("toJSON", toJSONOptions());

module.exports = {
  User: mongoose.model("User", userSchema),
  Slot: mongoose.model("Slot", slotSchema),
  Vehicle: mongoose.model("Vehicle", vehicleSchema)
};
