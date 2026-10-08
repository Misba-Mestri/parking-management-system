/**
 * Vehicle Parking Management System - Backend Server
 * Stack: Node.js + Express + MongoDB (Mongoose)
 * Run:   npm install   then   npm start   (MongoDB must be running)
 * Serves API on /api/* and the frontend static files on /
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");

const config = require("./config");
const { User, Slot, Vehicle } = require("./models");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = "mongodb+srv://mestrimisba16_db_user:Misba123@cluster0.pv0xldi.mongodb.net/parkdesk?retryWrites=true&w=majority&appName=Cluster0";

// Auth: students register with student ID, email, phone + password. Passwords are stored as
// salted scrypt hashes. Each login creates a random session token kept in memory
// (restarting the server logs everyone out).
const sessions = new Map(); // token -> { studentId, createdAt }

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

// ---------- Password / session helpers ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const attempt = crypto.scryptSync(password, user.salt, 64);
  const stored = Buffer.from(user.passwordHash, "hex");
  return stored.length === attempt.length && crypto.timingSafeEqual(stored, attempt);
}

function createSession(studentId) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { studentId, createdAt: Date.now() });
  return token;
}

// ---------- Validation helpers ----------

const RE_NAME = /^[A-Za-z][A-Za-z .'-]{1,59}$/;
const RE_STUDENT_ID = /^[A-Za-z0-9]{5,15}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_PHONE = /^[6-9][0-9]{9}$/; // 10-digit Indian mobile number
const RE_PLATE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$/; // e.g. DL05AB1234
const RE_PASSWORD = /^(?=.*[A-Za-z])(?=.*[0-9]).{8,64}$/;

function cleanPlate(value) {
  return String(value || "").replace(/[\s-]/g, "").toUpperCase();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Wrap async route handlers so errors become a clean 500 response
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: "Server error. Please try again." });
  });

// ---------- Startup: create the slots the first time ----------

async function ensureSlots() {
  if ((await Slot.countDocuments()) > 0) return;
  const prefixes = { bike: "B", car: "C", heavy: "H" };
  const slots = [];
  Object.entries(config.slotCounts).forEach(([type, count]) => {
    for (let i = 1; i <= count; i++) {
      slots.push({ _id: `${prefixes[type]}${String(i).padStart(2, "0")}`, type });
    }
  });
  await Slot.insertMany(slots);
  console.log(`Created ${slots.length} parking slots.`);
}

// ---------- Auth middleware ----------

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const session = token ? sessions.get(token) : null;
    const user = session ? await User.findOne({ studentId: session.studentId, role: "student" }).lean() : null;
    if (!user) {
      if (token) sessions.delete(token);
      return res.status(401).json({ error: "Unauthorized. Please log in again." });
    }
    req.user = user.studentId;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error. Please try again." });
  }
}

// ---------- Auth routes ----------

app.post("/api/auth/register", wrap(async (req, res) => {
  const body = req.body || {};
  const fullName = String(body.fullName || "").trim().replace(/\s+/g, " ");
  const studentId = String(body.studentId || "").trim().toUpperCase();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const password = typeof body.password === "string" ? body.password : "";

  if (!fullName || !studentId || !email || !phone || !password) {
    return res.status(400).json({ error: "Full name, student ID, email, phone and password are all required." });
  }
  if (!RE_NAME.test(fullName)) {
    return res.status(400).json({ error: "Enter a valid full name (2-60 letters; spaces, . ' - allowed)." });
  }
  if (!RE_STUDENT_ID.test(studentId)) {
    return res.status(400).json({ error: "Student ID must be 5-15 letters/numbers with no spaces or symbols." });
  }
  if (!RE_EMAIL.test(email) || email.length > 100) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (!RE_PHONE.test(phone)) {
    return res.status(400).json({ error: "Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9." });
  }
  if (!RE_PASSWORD.test(password)) {
    return res.status(400).json({ error: "Password must be 8-64 characters and include at least one letter and one number." });
  }

  if (await User.exists({ studentId })) {
    return res.status(409).json({ error: "A student with that ID is already registered." });
  }
  if (await User.exists({ email })) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }
  if (await User.exists({ phone })) {
    return res.status(409).json({ error: "An account with that phone number already exists." });
  }

  const { salt, hash } = hashPassword(password);
  try {
    await User.create({ fullName, studentId, email, phone, salt, passwordHash: hash });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "That student ID, email or phone is already registered." });
    }
    throw err;
  }

  // Registration does NOT log the user in; the student must sign in afterwards.
  res.status(201).json({ message: "Registration successful. You can now sign in.", studentId });
}));

app.post("/api/auth/login", wrap(async (req, res) => {
  const body = req.body || {};
  const studentId = String(body.studentId || "").trim().toUpperCase();
  const password = typeof body.password === "string" ? body.password : "";

  if (!studentId || !password) {
    return res.status(400).json({ error: "Enter your student ID and password." });
  }
  if (!RE_STUDENT_ID.test(studentId)) {
    return res.status(400).json({ error: "Enter a valid student ID." });
  }

  const user = await User.findOne({ studentId, role: "student" });
  if (!user) {
    return res.status(403).json({ error: "This student ID is not registered. Please register first." });
  }
  if (!verifyPassword(password, user)) {
    return res.status(401).json({ error: "Incorrect student ID or password." });
  }
  res.json({ token: createSession(user.studentId), studentId: user.studentId, fullName: user.fullName });
}));

// Everything below requires a logged-in, registered student
app.use("/api", requireAuth);

// ---------- Slot routes ----------

app.get("/api/slots", wrap(async (req, res) => {
  const slots = await Slot.find().sort({ _id: 1 });
  res.json(slots);
}));

// ---------- Dashboard ----------

app.get("/api/dashboard", wrap(async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const [totalSlots, occupied, todayEntries, revenueAgg, currentlyParked, perType] = await Promise.all([
    Slot.countDocuments(),
    Slot.countDocuments({ occupied: true }),
    Vehicle.countDocuments({ entryTime: { $gte: startOfDay, $lt: endOfDay } }),
    Vehicle.aggregate([
      { $match: { status: "exited", exitTime: { $gte: startOfDay, $lt: endOfDay } } },
      { $group: { _id: null, total: { $sum: "$fee" } } }
    ]),
    Vehicle.countDocuments({ status: "parked" }),
    Slot.aggregate([
      { $group: { _id: "$type", total: { $sum: 1 }, occupied: { $sum: { $cond: ["$occupied", 1, 0] } } } }
    ])
  ]);

  const typeBreakdown = { bike: { total: 0, occupied: 0 }, car: { total: 0, occupied: 0 }, heavy: { total: 0, occupied: 0 } };
  perType.forEach((t) => {
    typeBreakdown[t._id] = { total: t.total, occupied: t.occupied };
  });

  res.json({
    totalSlots,
    occupied,
    available: totalSlots - occupied,
    todayEntries,
    todayRevenue: revenueAgg.length ? revenueAgg[0].total : 0,
    typeBreakdown,
    currentlyParked
  });
}));

// ---------- Vehicle entry ----------

app.post("/api/vehicles/entry", wrap(async (req, res) => {
  const body = req.body || {};
  const cleanNumber = cleanPlate(body.vehicleNumber);
  const type = String(body.type || "");
  const ownerName = String(body.ownerName || "").trim().replace(/\s+/g, " ");
  const phone = String(body.phone || "").trim();

  if (!cleanNumber || !type || !ownerName) {
    return res.status(400).json({ error: "Vehicle number, type and owner name are required." });
  }
  if (!RE_PLATE.test(cleanNumber)) {
    return res.status(400).json({ error: "Enter a valid vehicle number, e.g. DL 05 AB 1234." });
  }
  if (!["bike", "car", "heavy"].includes(type)) {
    return res.status(400).json({ error: "Vehicle type must be bike, car or heavy." });
  }
  if (!RE_NAME.test(ownerName)) {
    return res.status(400).json({ error: "Enter a valid owner name (letters only, 2-60 characters)." });
  }
  if (phone && !RE_PHONE.test(phone)) {
    return res.status(400).json({ error: "Enter a valid 10-digit mobile number or leave it blank." });
  }

  const alreadyParked = await Vehicle.findOne({ vehicleNumber: cleanNumber, status: "parked" });
  if (alreadyParked) {
    return res.status(409).json({ error: `${cleanNumber} is already parked in slot ${alreadyParked.slotId}.` });
  }

  // Atomically claim the first free slot of this type (safe even if two entries happen together)
  const slot = await Slot.findOneAndUpdate(
    { type, occupied: false },
    { $set: { occupied: true } },
    { sort: { _id: 1 }, new: true }
  );
  if (!slot) {
    return res.status(409).json({ error: `No free ${type} slots available right now.` });
  }

  let vehicle;
  try {
    vehicle = await Vehicle.create({ vehicleNumber: cleanNumber, type, ownerName, phone, slotId: slot._id });
  } catch (err) {
    // Could not save the vehicle: release the slot we just claimed
    await Slot.updateOne({ _id: slot._id }, { $set: { occupied: false, vehicleId: null } });
    if (err.code === 11000) {
      return res.status(409).json({ error: `${cleanNumber} is already parked.` });
    }
    throw err;
  }

  await Slot.updateOne({ _id: slot._id }, { $set: { vehicleId: vehicle._id } });
  res.status(201).json(vehicle);
}));

// ---------- Find a currently parked vehicle by plate number (used by the exit screen) ----------

app.get("/api/vehicles/search/:vehicleNumber", wrap(async (req, res) => {
  const number = cleanPlate(req.params.vehicleNumber);
  if (!RE_PLATE.test(number)) {
    return res.status(400).json({ error: "Enter a valid vehicle number, e.g. DL 05 AB 1234." });
  }
  const vehicle = await Vehicle.findOne({ vehicleNumber: number, status: "parked" });
  if (!vehicle) {
    return res.status(404).json({ error: "No parked vehicle found with that number." });
  }
  res.json(vehicle);
}));

// ---------- Vehicle exit ----------

app.post("/api/vehicles/:id/exit", wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: "Invalid vehicle record." });
  }
  const vehicle = await Vehicle.findById(req.params.id);
  if (!vehicle) return res.status(404).json({ error: "Vehicle record not found." });
  if (vehicle.status !== "parked") return res.status(409).json({ error: "This vehicle has already exited." });

  const exitTime = new Date();
  const durationMinutes = Math.max(1, Math.ceil((exitTime - vehicle.entryTime) / 60000));
  const hours = Math.max(1, Math.ceil(durationMinutes / 60)); // minimum 1 hour billed
  const fee = hours * config.rates[vehicle.type];

  // Only succeeds if the vehicle is still "parked" (prevents double checkout)
  const updated = await Vehicle.findOneAndUpdate(
    { _id: vehicle._id, status: "parked" },
    { $set: { exitTime, durationMinutes, fee, status: "exited" } },
    { new: true }
  );
  if (!updated) return res.status(409).json({ error: "This vehicle has already exited." });

  await Slot.updateOne({ _id: vehicle.slotId }, { $set: { occupied: false, vehicleId: null } });
  res.json(updated);
}));

// ---------- Records / listing with optional filters ----------

app.get("/api/vehicles", wrap(async (req, res) => {
  const { status, type, search, date } = req.query;
  const query = {};

  if (status && status !== "all") query.status = String(status);
  if (type && type !== "all") query.type = String(type);

  if (search) {
    const term = escapeRegex(String(search).trim());
    const plateTerm = escapeRegex(cleanPlate(search));
    query.$or = [
      { vehicleNumber: { $regex: plateTerm, $options: "i" } },
      { ownerName: { $regex: term, $options: "i" } }
    ];
  }

  if (date) {
    const day = new Date(date);
    if (isNaN(day)) return res.status(400).json({ error: "Invalid date filter." });
    day.setHours(0, 0, 0, 0);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    query.entryTime = { $gte: day, $lt: next };
  }

  const vehicles = await Vehicle.find(query).sort({ entryTime: -1 });
  res.json(vehicles);
}));

// Fallback: serve frontend's login page for unknown non-API GET routes
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "login.html"));
});

// ---------- Connect to MongoDB, then start the server ----------

mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log("Connected to MongoDB.");
    await Promise.all([User.init(), Vehicle.init(), Slot.init()]); // make sure indexes exist
    await ensureSlots();
    app.listen(PORT, () => {
      console.log(`Vehicle Parking Management System running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Could not connect to MongoDB:", err.message);
    console.error("Make sure MongoDB is running and MONGODB_URI is correct (see .env.example).");
    process.exit(1);
  });
