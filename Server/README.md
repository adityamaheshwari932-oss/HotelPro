# HotelPro Backend API

HotelPro is a hotel management system built on the MERN stack using Express 5, Node.js, and MongoDB with Mongoose.

---

## 1. Environment Configuration

Copy `.env.example` to `.env` and configure your environment variables:

```bash
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
MONGODB_URI=mongodb://127.0.0.1:27017/hotelpro

# JWT Authentication
# Must be at least 32 characters long
JWT_SECRET=your_jwt_secret_min_32_characters_here
JWT_EXPIRES_IN=15m

# Initial Administrator One-Time Setup Secret
# High-entropy token required to run the one-time admin setup workflow
ADMIN_SETUP_SECRET=your_high_entropy_admin_setup_secret_here
```

---

## 2. Authentication API Endpoints

### `POST /api/auth/register`
* **Access**: Public
* **Purpose**: Registers a new customer account.
* **Payload**:
  ```json
  {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "password": "Password123!",
    "phone": "+15551234567"
  }
  ```
* **Security Enforcement**:
  * Role is **strictly forced** to `customer`. Client-supplied roles (e.g. `admin`) are ignored.
  * Password must comply with the password policy: minimum 8 characters, at least 1 uppercase letter, 1 lowercase letter, 1 digit, and 1 special symbol.
  * Password is hashed using `bcryptjs` (cost factor 12) before saving.
  * Returns `201 Created` with sanitized user data. Never returns password hashes.

### `POST /api/auth/login`
* **Access**: Public
* **Purpose**: Authenticates credentials and returns a short-lived JSON Web Token (JWT).
* **Payload**:
  ```json
  {
    "email": "jane@example.com",
    "password": "Password123!"
  }
  ```
* **Security Enforcement**:
  * Generic `401 Unauthorized` (`"Invalid email or password."`) returned for both unknown emails and incorrect passwords to prevent account enumeration.
  * Suspended or inactive accounts are rejected with `403 Forbidden`.
  * Returns `200 OK` with a signed JWT (`token`) and basic user profile.

### `GET /api/auth/me`
* **Access**: Protected (Requires `Authorization: Bearer <token>`)
* **Purpose**: Retrieves the authenticated user's profile.
* **Headers**: `Authorization: Bearer <JWT_TOKEN>`
* **Returns**: `200 OK` with user profile.

---

## 3. Initial One-Time Administrator Initialization

To prevent privilege escalation vulnerabilities, public registration cannot create an Administrator account. The initial Administrator must be created using the protected, one-time setup script.

### Safe Initialization Procedure

1. Generate a strong, high-entropy secret (at least 32 characters) and configure it in your `.env` file:
   ```env
   ADMIN_SETUP_SECRET=c8f8b0e4a7d219f3e4b7c1a90d8e2f6b5a3c1e7d
   ```
2. Execute the one-time CLI setup script:
   ```bash
   node scripts/init-admin.js --name="System Administrator" --email="admin@hotelpro.com" --password="SuperAdminPassword123!" --secret="c8f8b0e4a7d219f3e4b7c1a90d8e2f6b5a3c1e7d"
   ```
   Alternatively, pass the parameters via environment variables:
   ```bash
   INIT_ADMIN_NAME="System Administrator" \
   INIT_ADMIN_EMAIL="admin@hotelpro.com" \
   INIT_ADMIN_PASSWORD="SuperAdminPassword123!" \
   ADMIN_SETUP_SECRET="c8f8b0e4a7d219f3e4b7c1a90d8e2f6b5a3c1e7d" \
   node scripts/init-admin.js
   ```

### Security & Concurrency Guarantees
* **Atomic Lock**: The setup script attempts to create an atomic `SystemLock` document with primary key `_id: 'initial_admin_setup'`. MongoDB's unique primary key index guarantees that only **one** concurrent execution can succeed.
* **Permanent Lockout**: Once an Administrator exists, any further attempts are permanently refused with `409 Conflict`.
* **Zero Secret Leakage**: The setup secret and password are never logged, persisted, or returned in any response.

---

## 4. Room Management & Availability Endpoints

### `GET /api/rooms`
* **Access**: Public
* **Query Parameters**:
  * `page` (default `1`)
  * `limit` (default `10`, max `50`)
  * `hotel` (MongoDB ObjectId)
  * `roomType` (`single`, `double`, `suite`)
  * `capacity` (minimum integer capacity)
  * `minPrice` / `maxPrice` (applied to `basePrice`)
  * `status` (Admin only; public requests default strictly to `active` rooms)
* **Response**: Paginated list of rooms excluding internal version keys (`__v`).

### `GET /api/rooms/:id`
* **Access**: Public
* **Purpose**: Retrieves room details by ID, populated with property information.

### `GET /api/rooms/search`
* **Access**: Public
* **Purpose**: Searches rooms available for a requested date range with dynamic date-specific pricing.
* **Query Parameters**:
  * `checkInDate` (Required, format `YYYY-MM-DD`)
  * `checkOutDate` (Required, format `YYYY-MM-DD`, must be after `checkInDate`)
  * `hotel`, `roomType`, `capacity` (Optional)
  * `minPrice` / `maxPrice` (Optional, applied to the calculated total stay price)
* **Availability Rules**:
  * A booking overlaps when: `existingCheckIn < requestedCheckOut AND existingCheckOut > requestedCheckIn`.
  * Blocking statuses: `confirmed`, `checked_in`, `pending`.
  * Non-blocking statuses: `cancelled`, `checked_out`.
  * Operational status: Rooms under `maintenance` or `inactive` are never returned as available.
* **Pricing Rules**:
  * Calculates nightly rates for each night from `checkInDate` (inclusive) to `checkOutDate` (exclusive).
  * Evaluates date-specific `pricingRules` using half-open intervals `[startDate, endDate)`.
  * Falls back to `basePrice` for nights with no matching rule.
  * Reports transparent nightly rate breakdown and total room rate without fabricating taxes or fees.

### `POST /api/rooms`
* **Access**: Protected (`Admin` only)
* **Purpose**: Creates a new room associated with an active hotel. Enforces per-hotel unique `roomNumber`.

### `PATCH /api/rooms/:id`
* **Access**: Protected (`Admin` only)
* **Purpose**: Updates permitted fields (`roomNumber`, `roomType`, `description`, `photos`, `basePrice`, `pricingRules`, `capacity`, `status`).

### `PATCH /api/rooms/:id/status`
* **Access**: Protected (`Admin` only)
* **Purpose**: Updates operational status (`active`, `maintenance`, `inactive`).

---

## 5. Booking Management & Double-Booking Prevention

### `POST /api/bookings`
* **Access**: Protected (Authenticated Customer or Admin)
* **Purpose**: Creates a new room reservation.
* **Payload**:
  ```json
  {
    "room": "654321098765432109876543",
    "checkInDate": "2026-11-01",
    "checkOutDate": "2026-11-04",
    "guestCount": 2,
    "guestInfo": {
      "name": "Alice Traveler",
      "email": "alice@example.com",
      "phone": "+15551234567"
    }
  }
  ```
* **Security & Business Rules**:
  * Authenticated customer ID is strictly taken from `req.user._id`. Body-supplied user IDs are disregarded to prevent spoofing.
  * Rejects bookings if room operational status is `maintenance` or `inactive`.
  * Rejects bookings if `guestCount` exceeds `room.capacity`.
  * Rejects bookings if associated hotel is nonexistent or inactive.
  * Calculates and freezes the `priceSnapshot` with nightly breakdown and `totalAmount`. Subsequent price changes to the room will not alter this snapshot.
* **Double-Booking Prevention (Concurrency Guarantee)**:
  * Uses an atomic per-room distributed lock backed by MongoDB's unique primary key (`_id: 'room_lock_' + roomId`) in `SystemLock`.
  * Serializes concurrent attempts targeting the *same* physical room; concurrent requests targeting *different* rooms execute in parallel.
  * Under the lock, queries for overlapping active bookings (`confirmed`, `checked_in`, `pending`). If found, rejects with `409 Conflict`.
  * Lock is reliably released via `finally` blocks, and orphaned locks are automatically reclaimed after a timeout.
* **Booking-Hold Expiration Policy & Background Sweeper**:
  * New reservations in `pending` status receive a 15-minute reservation hold deadline (`holdExpiresAt = createdAt + 15m`).
  * A background expiration worker runs every 30 seconds, scanning batches of up to 50 pending reservations that have passed their deadline.
  * Expired pending bookings are atomically transitioned to `status: 'cancelled'`, immediately releasing room dates for new reservations.
  * Repeated checkout requests do not extend the 15-minute hold. Initiating checkout on an expired hold is rejected with `400 Bad Request`.
  * Post-intent validation ensures that if a hold expires or a booking is cancelled while an external payment provider call is in flight, checkout is aborted, the external intent is safely cancelled (or marked for reconciliation if cancellation fails), and no pending payment session or client secret is returned.
  * If a payment succeeds after a booking has already expired and been cancelled, the booking remains cancelled and the payment records reconciliation metadata (`requiresRefund: true`).
  * Automatic refund execution is not implemented in this stage and is reserved for Stage 6.5.

### `GET /api/bookings/my`
* **Access**: Protected (Authenticated Customer)
* **Query Parameters**: `page` (default `1`), `limit` (default `10`), `status` (Optional)
* **Returns**: Paginated list of bookings owned exclusively by the authenticated user.

### `GET /api/bookings/:id`
* **Access**: Protected (Booking Owner or Admin)
* **Returns**: Full booking details. Rejects non-owners with `403 Forbidden`.

### `PATCH /api/bookings/:id/cancel`
* **Access**: Protected (Booking Owner or Admin)
* **Cancellation Policy**:
  * Only bookings with status `pending` or `confirmed` may be cancelled.
  * Bookings in `checked_in`, `checked_out`, or already `cancelled` cannot be cancelled.
  * Records `cancellation.cancelledAt` timestamp and reason.
  * Cancelled bookings immediately cease to block availability.

### `GET /api/bookings`
* **Access**: Protected (`Admin` only)
* **Query Parameters**: `page`, `limit`, `hotel`, `room`, `user`, `status`
* **Returns**: Paginated booking list across all users.

### `PATCH /api/bookings/:id/status`
* **Access**: Protected (`Admin` only)
* **Permitted Lifecycle Transitions**:
  * `pending` &rarr; `confirmed`, `cancelled`
  * `confirmed` &rarr; `checked_in`, `cancelled`
  * `checked_in` &rarr; `checked_out`
  * `checked_out` &rarr; Terminal (no further transitions)
  * `cancelled` &rarr; Terminal (no further transitions)
* Rejects invalid transitions with `400 Bad Request`.

---

## 6. Running Automated Tests

Run the complete backend test suite:
```bash
npm test
```
All tests run against isolated ephemeral databases or schema validators, leaving the main `hotelpro` database completely untouched.

---

## 7. Payment Processing, Webhooks, Refunds & Reconciliation

HotelPro implements an enterprise-grade, PCI-compliant payment lifecycle built on a provider abstraction pattern.

### 7.1 Payment Provider Abstraction
The payment architecture decouples business logic from gateway SDKs using `PaymentProvider` (`src/services/payment/provider.interface.js`):
* **`MockPaymentProvider`**: Deterministic in-memory provider for offline local development and test automation. Supports simulation flags (`shouldFail`, `delayMs`, `beforeComplete`, `mockId`).
* **`StripePaymentProvider`**: Production-ready Stripe integration using Stripe SDK (`stripe`). Isolates intent creation, signature verification, cancellations, and refunds.

### 7.2 Checkout Initiation
* **Endpoint**: `POST /api/payments/checkout-session`
* **Access**: Protected (Authenticated Customer)
* **Concurrency Protection**: Per-booking distributed lock (`withCheckoutLock`) backed by `SystemLock` prevents duplicate checkout sessions.
* **Active Session Deduplication**: If an active `pending` payment session already exists for the booking, it is reused rather than creating a new intent.
* **Post-Intent Fencing Revalidation**: Revalidates booking status after external provider network calls. If the reservation expired or was cancelled while in flight, the external intent is cancelled and no client secret is exposed.

### 7.3 Webhook Verification & Idempotency
* **Endpoints**: `POST /api/payments/webhook`, `POST /api/payments/webhook/:provider`
* **Access**: Public (Cryptographically authenticated via gateway signature)
* **Raw Body Preservation**: Preserves raw body bytes (`req.rawBody`) during JSON parsing for byte-level cryptographic signature verification (`stripe.webhooks.constructEvent`).
* **Durable Idempotency**: Tracked in `WebhookEvent` model with unique compound index `{ provider: 1, eventId: 1 }`.
* **Atomic Lease Recovery**: Uses `lockToken` UUIDs and `lockedAt` timestamps. Stale in-flight events (>15s) are reclaimed atomically, while concurrent fresh events receive `409 Conflict` to allow gateway retries without duplicate side effects.
* **Late Payment Reconciliation**: If a successful payment arrives for an expired or cancelled booking, the booking is **never** reconfirmed; the payment is flagged with `metadata.requiresRefund = 'true'` and `reconciliationStatus = 'refund_eligible'`.

### 7.4 Refund Lifecycle
* **Endpoint**: `POST /api/payments/:id/refund`
* **Access**: Protected (Booking Owner or Administrator)
* **Payload**:
  ```json
  {
    "amount": 100.50,
    "reason": "Customer requested partial refund",
    "idempotencyKey": "refund_req_xyz123"
  }
  ```
* **Safety & Guarantees**:
  * Only `completed` or `partially_refunded` payments can be refunded.
  * Defaults to full remaining refundable balance (`amount - totalRefunded`) if `amount` is omitted.
  * Strictly validates that cumulative refunds never exceed original captured payment amount.
  * Updates status to `partially_refunded` or `refunded` only upon verified provider confirmation.
  * Stores complete refund history and idempotency keys in `Payment.refunds`.

### 7.5 Reconciliation Administration
* **Endpoint**: `GET /api/payments/reconciliation`
* **Access**: Protected (`Admin` only)
* **Purpose**: Inspects payments with reconciliation flags (`requiresRefund = 'true'`, intent cancellation anomalies, or refund failures).

### 7.6 Policy-Neutral Foundation & Unresolved Business Decisions
To avoid unauthorized financial assumptions, the system implements a policy-neutral technical foundation:
* **Cancellation Cutoff**: No arbitrary cutoff window is hardcoded.
* **Refund Percentages / Fees**: Full refundable amount is available until an explicit business policy (e.g. tier-based refund penalties) is approved.
* **Automatic vs. Explicit Refunds**: Booking cancellation flags payments for refund reconciliation (`refund_eligible`) rather than executing silent financial movement without explicit authorization.


