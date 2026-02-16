require("dotenv").config();
const express = require("express");



const customerRoutes = require('./routes/customer.routes');
const cors = require("cors");
const session = require("express-session");
const path = require("path");
const db = require("./db");
const { handleIncomingMessage } = require("./logic");

const app = express();

app.use('/customer', express.static('public/customer'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "change_me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));





app.get("/admin/lang", (req, res) => {
  const l = String(req.query.l || "en");
  req.session.lang = supported.includes(l) ? l : "en";
  const back = req.get("Referer") || "/admin/settings";
  res.redirect(back);
});
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

  const products = (await db.query("SELECT * FROM products ORDER BY name ASC")).rows;

  const subs = (await db.query(
    `SELECT sp.*, p.name AS product_name
     FROM sub_products sp
     JOIN products p ON p.id = sp.product_id
     ORDER BY p.name ASC, sp.name ASC`
  )).rows;

  const subsByProduct = {};
  for (const sp of subs) {
    subsByProduct[sp.product_id] = subsByProduct[sp.product_id] || [];
    subsByProduct[sp.product_id].push(sp);
  }

  const tab = (req.query.tab || "add").toLowerCase();
  res.render("admin/settings", {  settings, products, subsByProduct, tab, q: req.query });
});app.post("/admin/settings", async (req, res) => {
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
      c.name AS customer_name,
      COALESCE(SUM(oi.qty),0) AS items_qty,
      COUNT(oi.id) AS items_count,
      COALESCE(o.items_total, o.total, 0) AS final_total,
      (
        SELECT string_agg(sp.name, ', ' ORDER BY oi2.id DESC)
        FROM order_items oi2
        JOIN sub_products sp ON sp.id = oi2.sub_product_id
        WHERE oi2.order_id = o.id
        LIMIT 2
      ) AS preview_items
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.order_status = $1
    ${extraWhere}
    GROUP BY o.id, c.phone, c.name
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

  const items = (await db.query(
    `
    SELECT oi.*, sp.name AS sub_name, sp.unit_label
    FROM order_items oi
    JOIN sub_products sp ON sp.id = oi.sub_product_id
    WHERE oi.order_id=$1
    ORDER BY oi.id DESC
    `,
    [id]
  )).rows;

  const subProducts = (await db.query(
    `
    SELECT sp.*, p.name AS product_name
    FROM sub_products sp
    JOIN products p ON p.id = sp.product_id
    WHERE sp.is_active=TRUE AND p.is_active=TRUE
    ORDER BY p.name ASC, sp.name ASC
    `
  )).rows;

  res.render("admin/order_detail", { order, settings, items, subProducts, q: req.query });
});// Update order fields
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



app.post("/admin/orders/:id/final", async (req, res) => {
  const id = req.params.id;
  const { qty, delivery_day, address_snapshot, price_per_unit } = req.body;

  const settings = (await db.query("SELECT * FROM settings WHERE id=1")).rows[0];
  const q = Math.max(0, parseFloat(qty || 0));

  // allow override price, else use settings price
  const p = price_per_unit && price_per_unit !== ""
    ? Math.max(0, parseFloat(price_per_unit))
    : Math.max(0, parseFloat(settings.today_price_per_unit));

  const subtotal = q * p;

  const freeThreshold = parseFloat(settings.free_delivery_threshold || 0);
  const deliveryCharge = subtotal >= freeThreshold ? 0 : parseFloat(settings.delivery_charge_amount || 0);

  const total = subtotal + deliveryCharge;

  await db.query(
    `UPDATE orders
     SET qty=$1,
         price_per_unit=$2,
         subtotal=$3,
         delivery_charge=$4,
         total=$5,
         delivery_day=$6,
         address_snapshot=$7,
         updated_at=NOW()
     WHERE id=$8`,
    [q, p, subtotal, deliveryCharge, total, (delivery_day || "TODAY"), (address_snapshot || ""), id]
  );

  res.redirect(`/admin/orders/${id}?toast=Final values saved`);
});




/* -------------------------
   PRODUCTS / SUB-PRODUCTS
------------------------- */

app.get("/admin/products", async (req, res) => {
  const products = (await db.query("SELECT * FROM products ORDER BY id DESC")).rows;
  res.render("admin/products", { products, q: req.query });
});

app.post("/admin/products", async (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.redirect("/admin/products?toast=Enter product name");
  await db.query("INSERT INTO products (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
  res.redirect("/admin/products?toast=Product added");
});

app.post("/admin/products/:id/toggle", async (req, res) => {
  const id = req.params.id;

  const row = (await db.query("SELECT is_active FROM products WHERE id=$1", [id])).rows[0];
  if (!row) return res.redirect("/admin/settings?tab=manage&toast=Product not found");

  const newState = !row.is_active;

  await db.query("UPDATE products SET is_active=$1 WHERE id=$2", [newState, id]);

  // ✅ cascade: product ON/OFF => all sub-products ON/OFF
  await db.query("UPDATE sub_products SET is_active=$1 WHERE product_id=$2", [newState, id]);

  res.redirect(`/admin/settings?tab=manage&toast=Product and sub-products updated`);
});
app.get("/admin/sub-products", async (req, res) => {
  const products = (await db.query("SELECT * FROM products ORDER BY name ASC")).rows;
  const subs = (await db.query(
    `SELECT sp.*, p.name AS product_name
     FROM sub_products sp
     JOIN products p ON p.id = sp.product_id
     ORDER BY sp.id DESC`
  )).rows;

  res.render("admin/sub_products", { products, subs, q: req.query });
});

app.post("/admin/sub-products", async (req, res) => {
  const product_id = parseInt(req.body.product_id, 10);
  const name = (req.body.name || "").trim();
  const price = parseFloat(req.body.price_per_unit || 0);
  const unit = (req.body.unit_label || "KG").trim();

  if (!product_id || !name) return res.redirect("/admin/sub-products?toast=Enter all fields");

  await db.query(
    `INSERT INTO sub_products (product_id, name, price_per_unit, unit_label)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (product_id, name)
     DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit, unit_label=EXCLUDED.unit_label`,
    [product_id, name, price, unit]
  );

  res.redirect("/admin/sub-products?toast=Sub-product saved");
});

app.post("/admin/sub-products/:id/toggle", async (req, res) => {
  const id = req.params.id;
  await db.query("UPDATE sub_products SET is_active = NOT is_active WHERE id=$1", [id]);
  res.redirect("/admin/sub-products?toast=Updated");
});




/* -------------------------
   CREATE PRODUCT + MULTI SUB-PRODUCTS
------------------------- */
app.post("/admin/products/create-with-subs", async (req, res) => {
  const productName = (req.body.product_name || "").trim();
  if (!productName) return res.redirect("/admin/settings?tab=add&toast=Enter product name");

  // Create product
  const product = (await db.query(
    `INSERT INTO products (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name
     RETURNING *`,
    [productName]
  )).rows[0];

  // Normalize arrays
  const names = Array.isArray(req.body.sub_name) ? req.body.sub_name : [req.body.sub_name];
  const prices = Array.isArray(req.body.sub_price) ? req.body.sub_price : [req.body.sub_price];
  const units = Array.isArray(req.body.sub_unit) ? req.body.sub_unit : [req.body.sub_unit];

  let added = 0;

  for (let i = 0; i < names.length; i++) {
    const n = (names[i] || "").trim();
    if (!n) continue;

    const price = Math.max(0, parseFloat(prices[i] || 0));
    const unit = (units[i] || "KG").trim() || "KG";

    await db.query(
      `INSERT INTO sub_products (product_id, name, price_per_unit, unit_label)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (product_id, name)
       DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit, unit_label=EXCLUDED.unit_label`,
      [product.id, n, price, unit]
    );

    added++;
  }

  res.redirect(`/admin/settings?tab=manage&toast=Saved ${product.name} (${added} sub-products)`);
});

app.post("/admin/products/:id/rename", async (req, res) => {
  const id = req.params.id;
  const name = (req.body.name || "").trim();
  if (!name) return res.redirect("/admin/settings?tab=manage&toast=Enter product name");
  await db.query("UPDATE products SET name=$1 WHERE id=$2", [name, id]);
  res.redirect("/admin/settings?tab=manage&toast=Product renamed");
});




/* -------------------------
   ORDER ITEMS
------------------------- */

// Add item to an order
app.post("/admin/orders/:id/items/add", async (req, res) => {
  const orderId = req.params.id;
  const subId = parseInt(req.body.sub_product_id, 10);
  const qty = Math.max(0, parseFloat(req.body.qty || 0));

  if (!subId || qty <= 0) {
    return res.redirect(`/admin/orders/${orderId}?toast=Select item and qty`);
  }

  const sp = (await db.query(
    "SELECT * FROM sub_products WHERE id=$1",
    [subId]
  )).rows[0];

  if (!sp) return res.redirect(`/admin/orders/${orderId}?toast=Invalid sub-product`);

  const price = parseFloat(sp.price_per_unit || 0);
  const subtotal = qty * price;

  await db.query(
    `INSERT INTO order_items (order_id, sub_product_id, qty, price_per_unit, subtotal)
     VALUES ($1,$2,$3,$4,$5)`,
    [orderId, subId, qty, price, subtotal]
  );

  await recalcOrderTotals(orderId);

  res.redirect(`/admin/orders/${orderId}?toast=Item added`);
});

// Remove item
app.post("/admin/orders/:orderId/items/:itemId/delete", async (req, res) => {
  const { orderId, itemId } = req.params;

  await db.query(
    "DELETE FROM order_items WHERE id=$1 AND order_id=$2",
    [itemId, orderId]
  );

  await recalcOrderTotals(orderId);

  res.redirect(`/admin/orders/${orderId}?toast=Item removed`);
});





/* -------------------------
   UPDATE FINAL ORDER DETAILS
------------------------- */
app.post("/admin/orders/:id/update-final", async (req, res) => {
  const id = req.params.id;
  const { address_snapshot, delivery_day } = req.body;

  await db.query(
    `
    UPDATE orders
    SET address_snapshot = $1,
        delivery_day = $2,
        updated_at = NOW()
    WHERE id = $3
    `,
    [
      address_snapshot || "",
      delivery_day || "TODAY",
      id
    ]
  );

  res.redirect(`/admin/orders/${id}?toast=Final details updated`);
});











app.use('/c', customerRoutes);


