require("dotenv").config();
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const path = require("path");
const db = require("./db");
const { handleIncomingMessage } = require("./logic");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "change_me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));

// EJS view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.get("/", (req, res) => res.send("Order Management System ✅ Running"));

/**
 * -------------------------
 * LOGIN + ADMIN AUTH
 * -------------------------
 */
app.get("/login", (req, res) => {
  res.render("admin/login", { error: null });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const okUser = (process.env.ADMIN_USER || "admin").trim();
  const okPass = (process.env.ADMIN_PASS || "admin123").trim();

  if (username === okUser && password === okPass) {
    req.session.isAdmin = true;
    return res.redirect("/admin/orders?status=DRAFT");
  }

  return res.status(401).render("admin/login", { error: "Invalid username or password" });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.use("/admin", (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect("/login");
});

/**
 * -------------------------
 * ADMIN ROUTES
 * -------------------------
 */

// Settings page
app.get("/admin/settings", async (req, res) => {
  const settings = (await db.query("SELECT * FROM settings WHERE id=1")).rows[0];
  res.render("admin/settings", { settings, q: req.query });
});

app.post("/admin/settings", async (req, res) => {
  const {
    product_name,
    today_price_per_unit,
    unit_label,
    free_delivery_threshold,
    delivery_charge_amount,
    upi_id,
  } = req.body;

  await db.query(
    `UPDATE settings SET
      product_name=$1,
      today_price_per_unit=$2,
      unit_label=$3,
      free_delivery_threshold=$4,
      delivery_charge_amount=$5,
      upi_id=$6,
      updated_at=NOW()
     WHERE id=1`,
    [
      product_name,
      today_price_per_unit,
      unit_label,
      free_delivery_threshold,
      delivery_charge_amount,
      upi_id,
    ]
  );

  res.redirect(`/admin/settings?key=${req.query.key}&saved=1`);
});

// Orders list
app.get("/admin/orders", async (req, res) => {
  const tab = (req.query.tab || "QUEUE").toUpperCase();
  const fsFilter = (req.query.fs || "").toUpperCase();

  const allowed = ["QUEUE", "ACTIVE", "CLOSED", "REJECTED"];
  const safeTab = allowed.includes(tab) ? tab : "QUEUE";

  const params = [safeTab];
  let extraWhere = "";

  if (safeTab === "ACTIVE" && ["CONFIRMED","DISPATCHED","DELIVERED"].includes(fsFilter)) {
    params.push(fsFilter);
    extraWhere = " AND o.fulfillment_status = $2 ";
  }

  const orders = (await db.query(
    `
    SELECT
      o.*,
      c.phone,
      c.name AS customer_name
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.order_status = $1
    ${extraWhere}
    ORDER BY o.created_at DESC
    LIMIT 200
    `,
    params
  )).rows;

  res.render("admin/orders", { orders, tab: safeTab, q: req.query });
});// Order detail
app.get("/admin/orders/:id", async (req, res) => {
  const id = req.params.id;

  const order = (await db.query(
    `
    SELECT
      o.*,
      c.phone,
      c.name AS customer_name
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id=$1
    `,
    [id]
  )).rows[0];

  if (!order) return res.status(404).send("Order not found");

  const settings = (await db.query("SELECT * FROM settings WHERE id=1")).rows[0];
  res.render("admin/order_detail", { order, settings, q: req.query });
});
// Update order fields
app.post("/admin/orders/:id/update", async (req, res) => {
  const id = req.params.id;

  const { qty, price_per_unit, delivery_day, address_snapshot } = req.body;

  // Recalculate totals
  const settings = (await db.query("SELECT * FROM settings WHERE id=1")).rows[0];

  const subtotal = parseFloat(qty) * parseFloat(price_per_unit);

  const deliveryCharge =
    subtotal >= parseFloat(settings.free_delivery_threshold)
      ? 0
      : parseFloat(settings.delivery_charge_amount);

  const total = subtotal + deliveryCharge;

  await db.query(
    `UPDATE orders SET
      qty=$1,
      price_per_unit=$2,
      subtotal=$3,
      delivery_charge=$4,
      total=$5,
      delivery_day=$6,
      address_snapshot=$7,
      updated_at=NOW()
     WHERE id=$8`,
    [qty, price_per_unit, subtotal, deliveryCharge, total, delivery_day, address_snapshot, id]
  );

  res.redirect(`/admin/orders/${id}?key=${req.query.key}`);
});

// Approve order
app.post("/admin/orders/:id/approve", async (req, res) => {
  const id = req.params.id;

  await db.query(
    `UPDATE orders
     SET order_status='ACTIVE',
         fulfillment_status='CONFIRMED',
         status='APPROVED',
         updated_at=NOW()
     WHERE id=$1`,
    [id]
  );

  res.redirect(`/admin/orders?tab=ACTIVE&toast=Order moved to Active Orders`);
});// Reject order
app.post("/admin/orders/:id/reject", async (req, res) => {
  const id = req.params.id;

  await db.query(
    `UPDATE orders
     SET order_status='REJECTED',
         status='REJECTED',
         updated_at=NOW()
     WHERE id=$1`,
    [id]
  );

  res.redirect(`/admin/orders?tab=REJECTED&toast=Order rejected`);
});// Delivered
app.post("/admin/orders/:id/delivered", async (req, res) => {
  const id = req.params.id;
  await db.query("UPDATE orders SET status='DELIVERED', updated_at=NOW() WHERE id=$1", [id]);
  res.redirect(`/admin/orders?status=DELIVERED&key=${req.query.key}&toast=Marked delivered`);
});
// Manual payment mark paid/unpaid
app.post("/admin/orders/:id/payment", async (req, res) => {
  const id = req.params.id;
  const { payment_status, payment_method, payment_note } = req.body;

  if (payment_status === "PAID") {
    await db.query(
      `UPDATE orders SET
        payment_status='PAID',
        payment_method=$1,
        payment_note=$2,
        paid_at=NOW(),
        updated_at=NOW()
       WHERE id=$3`,
      [payment_method, payment_note, id]
    );
  } else {
    await db.query(
      `UPDATE orders SET
        payment_status='UNPAID',
        payment_method=NULL,
        payment_note=NULL,
        paid_at=NULL,
        updated_at=NOW()
       WHERE id=$1`,
      [id]
    );
  }

  res.redirect(`/admin/orders/${id}?key=${req.query.key}`);
});

/**
 * -------------------------
 * WHATSAPP WEBHOOK ROUTES
 * -------------------------
 */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (messages && messages.length > 0) {
      const msg = messages[0];
      const from = msg.from;
      const text = msg.text?.body || "";
      await handleIncomingMessage(from, text);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));





















// Profile page
app.get('/admin/profile', (req, res) => {
  res.render('admin/profile');
});




app.post('/admin/orders/:id/dispatch', async (req, res) => {
  const id = req.params.id;
  await db.query(
    "UPDATE orders SET fulfillment_status='DISPATCHED', updated_at=NOW() WHERE id=$1",
    [id]
  );
  res.redirect("/admin/orders?tab=ACTIVE&toast=Marked dispatched");
});
app.post('/admin/orders/:id/mark-delivered', async (req, res) => {
  const id = req.params.id;
  await db.query(
    "UPDATE orders SET fulfillment_status='DELIVERED', updated_at=NOW() WHERE id=$1",
    [id]
  );
  res.redirect("/admin/orders?tab=ACTIVE&toast=Marked delivered");
});
app.post('/admin/orders/:id/close', async (req, res) => {
  const id = req.params.id;
  await db.query(
    "UPDATE orders SET order_status='CLOSED', status='DELIVERED', updated_at=NOW() WHERE id=$1",
    [id]
  );
  res.redirect("/admin/orders?tab=CLOSED&toast=Order closed");
});
app.post('/admin/orders/:id/payment', async (req, res) => {
  const id = req.params.id;
  const { payment_status, payment_method, payment_note } = req.body;

  await db.query(
    "UPDATE orders SET payment_status=$1, payment_method=$2, payment_note=$3, updated_at=NOW() WHERE id=$4",
    [payment_status || "UNPAID", payment_method || null, payment_note || null, id]
  );

  res.redirect(`/admin/orders/${id}?toast=Payment updated`);
});


