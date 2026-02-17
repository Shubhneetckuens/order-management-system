const express = require("express");
const router = express.Router();
const db = require("../db");

function requireCustomer(req, res, next) {
  if (req.session && req.session.customer_id) return next();
  return res.redirect("/c/link-expired");
}

function getCart(req) {
  if (!req.session.cart) req.session.cart = {};
  return req.session.cart;
}

router.get("/link-expired", (req, res) => {
  res.render("customer/link_expired");
});

router.get("/start", async (req, res) => {
  try {
    const token = String(req.query.t || "").trim();
    if (!token) return res.redirect("/c/link-expired");

    const q = await db.query(
      `SELECT id,
              name,
              address_text AS address,
              token_expires_at
       FROM customers
       WHERE login_token = $1
       LIMIT 1`,
      [token]
    );

    if (q.rowCount === 0) return res.redirect("/c/link-expired");

    const customer = q.rows[0];
    if (customer.token_expires_at && new Date(customer.token_expires_at) < new Date()) {
      return res.redirect("/c/link-expired");
    }

    req.session.customer_id = customer.id;

    const profileComplete = !!(customer.name && customer.address);
    return res.redirect(profileComplete ? "/c/home" : "/c/profile");
  } catch (e) {
    console.error(e);
    return res.redirect("/c/link-expired");
  }
});

router.get("/profile", requireCustomer, async (req, res) => {
  const id = req.session.customer_id;
  const q = await db.query(
    `SELECT id, phone, name, address_text AS address, latitude, longitude
     FROM customers
     WHERE id=$1`,
    [id]
  );
  res.render("customer/profile", { c: q.rows[0] });
});

router.post("/profile", requireCustomer, async (req, res) => {
  const id = req.session.customer_id;
  const name = String(req.body.name || "").trim();
  const address = String(req.body.address || "").trim();
  const lat = req.body.latitude ? Number(req.body.latitude) : null;
  const lng = req.body.longitude ? Number(req.body.longitude) : null;

  await db.query(
    `UPDATE customers
     SET name=$1, address_text=$2, latitude=$3, longitude=$4, updated_at=NOW()
     WHERE id=$5`,
    [name, address, lat, lng, id]
  );

  res.redirect("/c/home");
});

router.get("/home", requireCustomer, async (req, res) => {
  const id = req.session.customer_id;
  const q = await db.query(
    `SELECT id, name, address_text AS address
     FROM customers
     WHERE id=$1`,
    [id]
  );
  res.render("customer/home", { c: q.rows[0] });
});

/* STATUS RULE (Customer UI):
   - order_status = QUEUE / ACTIVE / CLOSED / REJECTED
   - fulfillment_status = CONFIRMED / DISPATCHED / DELIVERED
   Display:
   - QUEUE => "Queue"
   - ACTIVE => fulfillment_status (Confirmed/Dispatched/Delivered)
   - CLOSED => "Closed"
   - REJECTED => "Rejected"
*/
router.get("/orders", requireCustomer, async (req, res) => {
  const id = req.session.customer_id;

  const q = await db.query(
    `SELECT id,
            created_at,
            status,
            order_status,
            fulfillment_status,
            total,
            payment_status
     FROM orders
     WHERE customer_id=$1
     ORDER BY created_at DESC
     LIMIT 50`,
    [id]
  );

  const orders = q.rows.map(o => {
    const os = String(o.order_status || "").toUpperCase();
    const fs = String(o.fulfillment_status || "").toUpperCase();

    let display = "Queue";
    let chip = "queue";

    if (os === "ACTIVE") {
      if (fs === "DISPATCHED") { display = "Dispatched"; chip = "active"; }
      else if (fs === "DELIVERED") { display = "Delivered"; chip = "active"; }
      else { display = "Confirmed"; chip = "active"; }
    } else if (os === "CLOSED") {
      display = "Closed"; chip = "closed";
    } else if (os === "REJECTED") {
      display = "Rejected"; chip = "closed";
    }

    return {
      ...o,
      total_amount: o.total,
      status_display: display,
      status_chip: chip
    };
  });

  res.render("customer/orders", { orders });
});

router.get("/orders/:id", requireCustomer, async (req, res) => {
  const customerId = req.session.customer_id;
  const orderId = Number(req.params.id);

  const o = await db.query(
    `SELECT *
     FROM orders
     WHERE id=$1 AND customer_id=$2
     LIMIT 1`,
    [orderId, customerId]
  );
  if (o.rowCount === 0) return res.redirect("/c/orders");

  const items = await db.query(
    `SELECT oi.qty AS quantity,
            oi.price_per_unit AS price,
            oi.subtotal,
            sp.name AS sub_name,
            p.name AS product_name,
            sp.unit_label AS unit
     FROM order_items oi
     JOIN sub_products sp ON sp.id = oi.sub_product_id
     JOIN products p ON p.id = sp.product_id
     WHERE oi.order_id=$1
     ORDER BY p.name, sp.name`,
    [orderId]
  );

  const order = o.rows[0];

  const os = String(order.order_status || "").toUpperCase();
  const fs = String(order.fulfillment_status || "").toUpperCase();

  let display = "Queue";
  if (os === "ACTIVE") {
    if (fs === "DISPATCHED") display = "Dispatched";
    else if (fs === "DELIVERED") display = "Delivered";
    else display = "Confirmed";
  } else if (os === "CLOSED") display = "Closed";
  else if (os === "REJECTED") display = "Rejected";

  order.status_display = display;

  res.render("customer/order_detail", { order, items: items.rows });
});

router.get("/new", requireCustomer, (req, res) => { return res.redirect("/c/products"); });
router.get("/products", requireCustomer, async (req, res) => {
  const products = await db.query(
    `SELECT id, name
     FROM products
     WHERE is_active=true
     ORDER BY name`
  );

  const subs = await db.query(
    `SELECT id, product_id, name, price_per_unit AS price, unit_label AS unit, image_url, is_active
     FROM sub_products
     WHERE is_active=true
     ORDER BY product_id, name`
  );

  const cart = getCart(req);
  res.render("customer/products", { products: products.rows, subs: subs.rows, cart });
});

/* NEW: Set cart quantities from product page (multi-select)
   body: qty[SUB_ID]=N
*/
router.post("/cart/set", requireCustomer, (req, res) => {
  const cart = {};

  // Most reliable: cart_json coming from products page JS
  if (req.body && req.body.cart_json) {
    try {
      const obj = JSON.parse(String(req.body.cart_json || "{}"));
      for (const sid of Object.keys(obj)) {
        const q = Number(obj[sid] || 0);
        if (q > 0) cart[String(sid)] = q;
      }
    } catch (e) { /* ignore */ }
  }

  // Backward compatible: qty object (extended=true)
  if (Object.keys(cart).length === 0 && req.body && req.body.qty && typeof req.body.qty === "object") {
    for (const sid of Object.keys(req.body.qty)) {
      const q = Number(req.body.qty[sid] || 0);
      if (q > 0) cart[String(sid)] = q;
    }
  }

  // Backward compatible: flat keys qty[ID]
  if (Object.keys(cart).length === 0 && req.body && typeof req.body === "object") {
    for (const k of Object.keys(req.body)) {
      const m = /^qty\[(\d+)\]$/.exec(k);
      if (!m) continue;
      const sid = m[1];
      const q = Number(req.body[k] || 0);
      if (q > 0) cart[String(sid)] = q;
    }
  }

  req.session.cart = cart;
  return res.redirect("/c/cart");
});/* NEW: +/- in cart
   body: sub_product_id, delta (+1/-1)
*/
router.post("/cart/update", requireCustomer, (req, res) => {
  const cart = getCart(req);
  const sid = String(req.body.sub_product_id || "").trim();
  const delta = Number(req.body.delta || 0);

  if (!sid || !Number.isFinite(delta) || delta === 0) return res.redirect("/c/cart");

  const next = Number(cart[sid] || 0) + delta;
  if (next <= 0) delete cart[sid];
  else cart[sid] = next;

  req.session.cart = cart;
  res.redirect("/c/cart");
});

router.get("/cart", requireCustomer, async (req, res) => {
  const cart = getCart(req);
  const ids = Object.keys(cart).map((x) => Number(x)).filter(Boolean);

  let rows = [];
  if (ids.length) {
    const q = await db.query(
      `SELECT sp.id, sp.name AS sub_name, sp.price_per_unit AS price, sp.unit_label AS unit, sp.image_url, p.name AS product_name
       FROM sub_products sp
       JOIN products p ON p.id = sp.product_id
       WHERE sp.id = ANY($1::int[])`,
      [ids]
    );

    rows = q.rows.map((r) => {
      const qty = Number(cart[String(r.id)] || 0);
      const price = Number(r.price || 0);
      return { ...r, qty, line: qty * price };
    });
  }

  const itemsTotal = rows.reduce((a, b) => a + (b.line || 0), 0);

  const s = await db.query(`SELECT free_delivery_threshold, delivery_charge_amount FROM settings WHERE id=1`);
  const freeTh = Number(s.rows[0]?.free_delivery_threshold || 0);
  const delFee = Number(s.rows[0]?.delivery_charge_amount || 0);

  const delivery = itemsTotal >= freeTh ? 0 : delFee;
  const total = itemsTotal + delivery;

  res.render("customer/cart", { rows, itemsTotal, delivery, total, freeTh });
});

router.post("/orders/:id/add-to-cart", requireCustomer, async (req, res) => {
  const customerId = req.session.customer_id;
  const orderId = Number(req.params.id);

  const o = await db.query(
    `SELECT id FROM orders WHERE id=$1 AND customer_id=$2 LIMIT 1`,
    [orderId, customerId]
  );
  if (o.rowCount === 0) return res.redirect("/c/orders");

  const items = await db.query(
    `SELECT sub_product_id, qty
     FROM order_items
     WHERE order_id=$1`,
    [orderId]
  );

  const cart = getCart(req);
  for (const it of items.rows) {
    const sid = String(it.sub_product_id);
    const qty = Number(it.qty || 0);
    if (!(qty > 0)) continue;
    cart[sid] = (Number(cart[sid] || 0) + qty);
  }

  req.session.cart = cart;
  res.redirect("/c/cart");
});

router.get("/checkout", requireCustomer, async (req, res) => {
  const customerId = req.session.customer_id;

  const cust = await db.query(
    `SELECT id, name, address_text AS address, latitude, longitude
     FROM customers
     WHERE id=$1`,
    [customerId]
  );

  const cart = getCart(req);
  const ids = Object.keys(cart).map((x) => Number(x)).filter(Boolean);

  let rows = [];
  if (ids.length) {
    const q = await db.query(
      `SELECT sp.id, sp.name AS sub_name, sp.price_per_unit AS price, sp.unit_label AS unit, sp.image_url, p.name AS product_name
       FROM sub_products sp
       JOIN products p ON p.id = sp.product_id
       WHERE sp.id = ANY($1::int[])`,
      [ids]
    );

    rows = q.rows.map((r) => {
      const qty = Number(cart[String(r.id)] || 0);
      const price = Number(r.price || 0);
      return { ...r, qty, line: qty * price };
    });
  }

  const itemsTotal = rows.reduce((a, b) => a + (b.line || 0), 0);

  const s = await db.query(`SELECT free_delivery_threshold, delivery_charge_amount, upi_id FROM settings WHERE id=1`);
  const freeTh = Number(s.rows[0]?.free_delivery_threshold || 0);
  const delFee = Number(s.rows[0]?.delivery_charge_amount || 0);

  const delivery = itemsTotal >= freeTh ? 0 : delFee;
  const total = itemsTotal + delivery;

    const QRCode = require("qrcode");
  const upi_id = (s.rows[0]?.upi_id || "").trim();
  let upi_link = "";
  let qr_data_url = "";

  if (upi_id) {
    // UPI deep link (amount included). pn can be changed later to your shop name.
    upi_link = `upi://pay?pa=${encodeURIComponent(upi_id)}&pn=${encodeURIComponent("Order Management System")}&am=${encodeURIComponent(String(total))}&cu=INR`;
    qr_data_url = await QRCode.toDataURL(upi_link);
  }

  res.render("customer/checkout", { c: cust.rows[0], rows, itemsTotal, delivery, total, upi_id, upi_link, qr_data_url });
});

router.post("/place", requireCustomer, async (req, res) => {
  const customerId = req.session.customer_id;
  const cart = getCart(req);
  const ids = Object.keys(cart).map((x) => Number(x)).filter(Boolean);
  if (!ids.length) return res.redirect("/c/products");

  const delivery_day = String(req.body.delivery_day || "today");
  const delivery_date = req.body.delivery_date ? String(req.body.delivery_date) : null;
  const payment_method = String(req.body.payment_method || "COD");

  const cust = await db.query(
    `SELECT address_text AS address, latitude, longitude
     FROM customers
     WHERE id=$1`,
    [customerId]
  );

  const address = cust.rows[0]?.address || "";
  const lat = cust.rows[0]?.latitude ?? null;
  const lng = cust.rows[0]?.longitude ?? null;

  const sp = await db.query(
    `SELECT id, price_per_unit
     FROM sub_products
     WHERE id = ANY($1::int[])`,
    [ids]
  );

  const priceMap = new Map(sp.rows.map((r) => [String(r.id), Number(r.price_per_unit || 0)]));

  let itemsSubtotal = 0;
  for (const sid of Object.keys(cart)) {
    const qty = Number(cart[sid] || 0);
    const price = priceMap.get(String(sid)) || 0;
    itemsSubtotal += qty * price;
  }

  const s = await db.query(`SELECT free_delivery_threshold, delivery_charge_amount FROM settings WHERE id=1`);
  const freeTh = Number(s.rows[0]?.free_delivery_threshold || 0);
  const delFee = Number(s.rows[0]?.delivery_charge_amount || 0);

  const delivery_charge = itemsSubtotal >= freeTh ? 0 : delFee;
  const total = itemsSubtotal + delivery_charge;

  const orderIns = await db.query(
    `INSERT INTO orders
      (customer_id, qty, unit_label, price_per_unit, subtotal, delivery_charge, total, delivery_day, address_snapshot,
       status, payment_status, payment_method, items_subtotal, items_total, drop_lat, drop_lng, delivery_date,
       order_status, fulfillment_status)
     VALUES
      ($1, 0, 'MULTI', 0, $2, $3, $4, $5, $6,
       'DRAFT', 'UNPAID', $7, $2, $4, $8, $9, $10,
       'QUEUE', 'CONFIRMED')
     RETURNING id`,
    [customerId, itemsSubtotal, delivery_charge, total, delivery_day, address, payment_method, lat, lng, delivery_date]
  );

  const orderId = orderIns.rows[0].id;

  for (const sid of Object.keys(cart)) {
    const qty = Number(cart[sid] || 0);
    if (!(qty > 0)) continue;
    const price = priceMap.get(String(sid)) || 0;
    const subtotal = qty * price;

    await db.query(
      `INSERT INTO order_items (order_id, sub_product_id, qty, price_per_unit, subtotal)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, Number(sid), qty, price, subtotal]
    );
  }

  req.session.cart = {};
  res.redirect(`/c/orders/${orderId}`);
});

module.exports = router;


