# ParkDesk — Vehicle Parking Management System

A full-stack web app for managing a parking facility: vehicle check-in/check-out,
automatic slot assignment, fee calculation, and live occupancy/revenue reporting.
Built for a BTech CSE mini/major project — simple enough to explain in a viva,
complete enough to demo end-to-end.

## Tech stack

| Layer     | Technology |
|-----------|------------|
| Backend   | Node.js + Express (REST API) |
| Database  | MongoDB (via Mongoose) — collections: `users`, `slots`, `vehicles` |
| Frontend  | HTML, CSS, vanilla JavaScript (no framework/build step) |
| Auth      | Student registration + login (student ID & password) with salted scrypt hashing and per-login bearer tokens |

## MongoDB setup (do this once)

Choose **one** option:

**Option A — Local MongoDB**
1. Install *MongoDB Community Server* from https://www.mongodb.com/try/download/community
   (tick "Install as a Service" on Windows so it starts automatically). Optionally install
   *MongoDB Compass* (GUI) to browse your data.
2. Check it is running: open a terminal and run `mongosh` — you should get a prompt.
3. Nothing else to create: the database `parkdesk` and its collections are created
   automatically on first use.

**Option B — MongoDB Atlas (free cloud database)**
1. Create a free cluster at https://www.mongodb.com/atlas.
2. Database Access → add a user with a password. Network Access → allow your IP.
3. Click *Connect → Drivers* and copy the connection string.

Then, inside `backend/`, copy `.env.example` to `.env` and set `MONGODB_URI`
(Local default: `mongodb://127.0.0.1:27017/parkdesk`; for Atlas paste your string).
If you skip the `.env` file, the local default above is used.

## Project structure

```
parking-management-system/
├── backend/
│   ├── server.js        # Express app: all API routes + serves the frontend + DB connect
│   ├── models.js        # Mongoose models: User, Slot, Vehicle
│   ├── config.js        # Hourly rates and slot counts
│   ├── .env.example     # Copy to .env and set MONGODB_URI
│   └── package.json
├── frontend/
│   ├── login.html
│   ├── register.html    # Student registration (with validation)
│   ├── dashboard.html   # Live stats + slot occupancy grid
│   ├── entry.html        # Register an incoming vehicle
│   ├── exit.html         # Look up a vehicle, calculate fee, check out
│   ├── records.html      # Searchable/filterable log of all vehicles
│   ├── css/style.css
│   └── js/api.js          # Shared fetch/auth helpers
└── README.md
```

## How to run it

Requires Node.js 16+ (check with `node -v`) and a running MongoDB (see above).

```bash
cd parking-management-system/backend
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

**First time here?** Anyone can register as a student: click **Register as a student**
on the sign-in page (or open `/register.html`) and fill in the form. After registering you
are sent to the sign-in page. **Only registered students can log in** and use the system —
there is no default/demo account.

## How it works

- **Registration** (`register.html`) is open to anyone and collects full name, student ID,
  email, 10-digit mobile number and a password (entered twice). Validation (checked in the
  browser and again on the server):
  - Full name: 2-60 letters (spaces, `.`, `'`, `-` allowed)
  - Student ID: 5-15 letters/numbers, unique
  - Email: valid format, unique
  - Mobile: 10 digits starting with 6-9, unique
  - Password: 8-64 characters with at least one letter and one number
  Only a salted `scrypt` hash of the password is stored. Registering does not log you in.
- **Login** takes student ID + password. Unregistered IDs are rejected, wrong passwords are
  rejected, and a random session token is issued on success (kept in server memory, so
  restarting the server signs everyone out). Every other API route requires that token.
- **Form validation** on check-in/check-out: vehicle number must match the Indian format
  (e.g. `DL 05 AB 1234`; spaces/hyphens are ignored), owner name must be letters only,
  phone (optional) must be a valid 10-digit mobile number.
- **Slots** are generated automatically in the `slots` collection the first time the server
  starts, based on `slotCounts` in `backend/config.js` (default: 15 two-wheeler, 20 car,
  5 bus/truck). A slot is claimed with one atomic MongoDB update, so two simultaneous
  check-ins can never get the same slot.
- **Check-in** (`entry.html`) takes the plate number, type and owner details, finds
  the first free slot of that type, and marks it occupied.
- **Check-out** (`exit.html`) looks the vehicle up by plate number, computes the
  parked duration, bills whole hours at the per-type rate (minimum 1 hour), and
  frees the slot.
- **Records** (`records.html`) lists every vehicle with filters for status, type
  and a text search over plate number / owner name.
- **Dashboard** shows total/occupied/available slots, today's entries and revenue,
  and a live slot map, refreshing every 15 seconds.

Default rates (edit in `backend/config.js` → `rates`):

| Type | Rate |
|------|------|
| Two-wheeler | ₹10 / hour |
| Car | ₹20 / hour |
| Bus / Truck | ₹40 / hour |

## API reference

All routes except `/api/auth/register` and `/api/auth/login` require an `Authorization: Bearer <token>` header.

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/register` | `{ fullName, studentId, email, phone, password }` → `{ message, studentId }` (201) |
| POST | `/api/auth/login` | `{ studentId, password }` → `{ token, studentId, fullName }` (403 if not registered) |
| GET  | `/api/dashboard` | Occupancy + revenue stats |
| GET  | `/api/slots` | All slots with occupied/free status |
| POST | `/api/vehicles/entry` | `{ vehicleNumber, type, ownerName, phone }` → new record |
| GET  | `/api/vehicles/search/:vehicleNumber` | Find a currently parked vehicle |
| POST | `/api/vehicles/:id/exit` | Checks the vehicle out, returns duration + fee |
| GET  | `/api/vehicles?status=&type=&search=&date=` | Filtered list of all records |

## Ideas for extending it (good for a viva / report "future scope" section)

- Move to bcrypt/JWT with expiring sessions stored in MongoDB.
- Email verification and a "forgot password" flow for registered students.
- Add a reservation/pre-booking flow.
- QR-code based ticket issued at entry, scanned at exit.
- Monthly pass / subscription billing for regular vehicles.
- Multiple admin roles (gate operator vs. manager reports).
- SMS/email receipt on checkout.

## Database design (MongoDB collections)

| Collection | Key fields |
|------------|------------|
| `users`    | `studentId` (unique), `email` (unique), `phone` (unique), `fullName`, `salt`, `passwordHash`, `createdAt` |
| `slots`    | `_id` (e.g. `C01`), `type`, `occupied`, `vehicleId` |
| `vehicles` | `vehicleNumber`, `type`, `ownerName`, `phone`, `slotId`, `entryTime`, `exitTime`, `durationMinutes`, `fee`, `status` |

`vehicles` has a unique index on `vehicleNumber` for records with `status: "parked"`, so the same
plate can never be checked in twice at the same time.

## Troubleshooting

- **"Could not connect to MongoDB"** — MongoDB is not running or `MONGODB_URI` is wrong.
  Start the MongoDB service (or check your Atlas user/password and IP allow-list).
- **Port 3000 already in use** — set `PORT=4000` in `.env`.
- To wipe everything and start fresh, drop the database: `mongosh parkdesk --eval "db.dropDatabase()"`.
