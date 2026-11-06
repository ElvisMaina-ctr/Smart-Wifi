
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const path = require("path");
const db = require("./database");
const { stkPush, normalizePhone } = require("./mpesa");
const { createHotspotUser, removeHotspotUser } = require("./mikrotik");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const payLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8
});

const packages = [
  { id: "1h", name: "1 Hour", price: 10, durationSeconds: 3600, description: "Quick browsing" },
  { id: "3h", name: "3 Hours", price: 20, durationSeconds: 10800, description: "Study and browsing" },
  { id: "6h", name: "6 Hours", price: 30, durationSeconds: 21600, description: "Longer access" },
  { id: "12h", name: "12 Hours", price: 40, durationSeconds: 43200, description: "Half-day access" },
  { id: "24h", name: "24 Hours", price: 50, durationSeconds: 86400, description: "Full-day access" },
  { id: "7d", name: "7 Days", price: 250, durationSeconds: 604800, description: "Weekly access" }
];

const insertOrder = db.prepare(`
  INSERT INTO orders (id, phone, package_id, amount, duration_seconds, status, created_at)
  VALUES (@id, @phone, @package_id, @amount, @duration_seconds, 'pending', @created_at)
`);

const getOrder = db.prepare("SELECT * FROM orders WHERE id = ?");
const setCheckout = db.prepare("UPDATE orders SET checkout_request_id = ? WHERE id = ?");

const markPaid = db.prepare(`
  UPDATE orders SET status='paid', mpesa_receipt=?, paid_at=?, expires_at=?
  WHERE id=? AND status='pending'
`);

const setProvisioned = db.prepare(`
  UPDATE orders SET hotspot_username=?, hotspot_password=?, status='active'
  WHERE id=? AND status='paid'
`);

app.get("/api/packages", (req, res) => res.json(packages));

app.post("/api/pay", payLimiter, async (req, res) => {
  try {
    const selected = packages.find(p => p.id === req.body.packageId);
    if (!selected) {
      return res.status(400).json({ error: "Please select a valid package." });
    }

    const phone = normalizePhone(req.body.phone);
    const id = crypto.randomUUID();

    insertOrder.run({
      id,
      phone,
      package_id: selected.id,
      amount: selected.price,
      duration_seconds: selected.durationSeconds,
      created_at: new Date().toISOString()
    });

    const result = await stkPush({
      phone,
      amount: selected.price,
      orderId: id
    });

    if (!result.CheckoutRequestID) {
      throw new Error(result.errorMessage || result.ResponseDescription || "M-Pesa did not accept the request.");
    }

    setCheckout.run(result.CheckoutRequestID, id);

    res.json({
      orderId: id,
      message: "STK Push sent. Check your phone and enter your M-Pesa PIN."
    });

  } catch (error) {
    console.error("Payment initiation:", error.response?.data || error.message);
    res.status(400).json({
      error: error.message || "Could not start payment."
    });
  }
});

// Safaricom sends the payment result here.
app.post("/api/mpesa/callback/:secret", async (req, res) => {
  if (req.params.secret !== process.env.MPESA_CALLBACK_SECRET) {
    return res.sendStatus(404);
  }

  res.json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return;

    const order = db.prepare(
      "SELECT * FROM orders WHERE checkout_request_id = ?"
    ).get(callback.CheckoutRequestID);

    if (!order || order.status !== "pending") return;

    if (Number(callback.ResultCode) !== 0) {
      db.prepare("UPDATE orders SET status='failed' WHERE id=?").run(order.id);
      return;
    }

    const metadata = callback.CallbackMetadata?.Item || [];
    const receipt = metadata.find(x => x.Name === "MpesaReceiptNumber")?.Value || "";
    const paidAmount = Number(metadata.find(x => x.Name === "Amount")?.Value);

    if (paidAmount !== order.amount) {
      console.error("Payment amount mismatch for", order.id);
      return;
    }

    const paidAt = new Date();
    const expiresAt = new Date(
      paidAt.getTime() + order.duration_seconds * 1000
    );

    markPaid.run(
      receipt,
      paidAt.toISOString(),
      expiresAt.toISOString(),
      order.id
    );

    const username = `ev${crypto.randomBytes(6).toString("hex")}`;
    const password = crypto.randomBytes(9).toString("base64url");

    await createHotspotUser(
      username,
      password,
      order.duration_seconds,
      `ELVIS order ${order.id}`
    );

    setProvisioned.run(username, password, order.id);

  } catch (error) {
    console.error("Callback provisioning error:", error.response?.data || error.message);
  }
});

app.get("/api/status/:id", (req, res) => {
  const order = getOrder.get(req.params.id);

  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }

  res.json({
    status: order.status,
    username: order.status === "active" ? order.hotspot_username : undefined,
    password: order.status === "active" ? order.hotspot_password : undefined,
    expiresAt: order.expires_at,
    hotspotLoginOrigin: process.env.HOTSPOT_LOGIN_ORIGIN || ""
  });
});

// Expire users when their paid time ends.
async function expireUsers() {
  const due = db.prepare(
    "SELECT id, hotspot_username FROM orders WHERE status='active' AND expires_at <= ?"
  ).all(new Date().toISOString());

  for (const order of due) {
    try {
      if (order.hotspot_username) {
        await removeHotspotUser(order.hotspot_username);
      }

      db.prepare("UPDATE orders SET status='expired' WHERE id=?").run(order.id);

    } catch (error) {
      console.error("Could not expire hotspot user:", error.message);
    }
  }
}

async function retryPaidProvisioning() {
  const pending = db.prepare(
    "SELECT * FROM orders WHERE status='paid' AND hotspot_username IS NULL LIMIT 20"
  ).all();

  for (const order of pending) {
    try {
      const username = `ev${crypto.randomBytes(6).toString("hex")}`;
      const password = crypto.randomBytes(9).toString("base64url");

      await createHotspotUser(
        username,
        password,
        order.duration_seconds,
        `ELVIS order ${order.id}`
      );

      setProvisioned.run(username, password, order.id);

    } catch (error) {
      console.error("Provisioning retry failed:", error.message);
    }
  }
}

setInterval(expireUsers, 30_000);
setInterval(retryPaidProvisioning, 20_000);

expireUsers().catch(console.error);
retryPaidProvisioning().catch(console.error);

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme !== "Basic" || !encoded) {
    res.set("WWW-Authenticate", 'Basic realm="ELVIS Wi-Fi Admin"');
    return res.sendStatus(401);
  }

  let decoded = "";

  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {}

  const separator = decoded.indexOf(":");
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  const expectedUser = process.env.ADMIN_USERNAME || "admin";
  const expectedPass = process.env.ADMIN_PASSWORD;

  const suppliedDigest = crypto.createHash("sha256").update(password).digest();
  const expectedDigest = crypto.createHash("sha256")
    .update(expectedPass || "missing-admin-password")
    .digest();

  if (
    !expectedPass ||
    username !== expectedUser ||
    !crypto.timingSafeEqual(suppliedDigest, expectedDigest)
  ) {
    res.set("WWW-Authenticate", 'Basic realm="ELVIS Wi-Fi Admin"');
    return res.sendStatus(401);
  }

  next();
}

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

app.get("/api/admin/summary", requireAdmin, (req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS orders,
      SUM(CASE WHEN status IN ('paid','active','expired') THEN amount ELSE 0 END) AS collected,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) AS expired
    FROM orders
  `).get();

  const recent = db.prepare(`
    SELECT id, phone, package_id, amount, status, mpesa_receipt, created_at, expires_at
    FROM orders ORDER BY created_at DESC LIMIT 50
  `).all();

  res.json({ totals, recent });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`ELVIS Wi-Fi server running on port ${PORT}`);
});
