const express = require("express");
const crypto = require("crypto");

const router = express.Router();

/**
 * IMPORTANT: You must provide `req.app.locals.db` = pg Pool
 * If your app already has a pool in index.js, set:
 *   app.locals.db = pool;
 */
function db(req){
  const pool = req.app.locals.db;
  if(!pool) throw new Error("DB pool not found. Set app.locals.db = pool in src/index.js");
  return pool;
}

function requireCustomer(req, res, next){
  if(req.session && req.session.customer_id) return next();
  return res.redirect("/c/link-expired");
}

router.get("/link-expired", (req, res) => {
  res.render("customer/link_expired");
});

// /c/start?t=TOKEN
router.get("/start", async (req, res) => {
  try {
    const token = String(req.query.t || "").trim();
    if(!token) return res.redirect("/c/link-expired");

    const q = await db(req).query(
      "SELECT id, name, address, latitude, longitude, token_expires_at FROM customers WHERE login_token=$1 LIMIT 1",
      [token]
    );
    if(q.rowCount === 0) return res.redirect("/c/link-expired");

    const customer = q.rows[0];
    if(customer.token_expires_at && new Date(customer.token_expires_at) < new Date()){
      return res.redirect("/c/link-expired");
    }

    req.session.customer_id = customer.id;

    const profileComplete = customer.name && customer.address;
    return res.redirect(profileComplete ? "/c/home" : "/c/profile");
  } catch (e) {
    console.error(e);
    return res.redirect("/c/link-expired");
  }
});

// Profile
router.get("/profile", requireCustomer, async (req, res) => {
  const id = req.session.customer_id;
  const q = await db(req).query("SELECT id, phone, name, address, latitude, longitude FROM customers WHERE id=$1", [id]);
  res.render("customer/profile", { c: q.rows[0] });
});

router.post("/profile", requireCustomer, async (req, res) => {
  const id = req.session.customer_id;
  const name = String(req.body.name || "").trim();
  const address = String(req.body.address || "").trim();
  const lat = req.body.latitude ? Number(req.body.latitude) : null;
  const lng = req.body.longitude ? Number(req.body.longitude) : null;

  await db(req).query(
    "UPDATE customers SET name=$1, address=$2, latitude=$3, longitude=$4 WHERE id=$5",
    [name, address, lat, lng, id]
  );
  res.redirect("/c/home");
});

// Home
router.get("/home", requireCustomer, async (req, res) => {
  const id = req.session.customer_id;
  const q = await db(req).query("SELECT id, name, address FROM customers WHERE id=$1", [id]);
  res.render("customer/home", { c: q.rows[0] });
});

// My Orders list (Add to cart next to each)
router.get("/orders", requireCustomer, async (req, res) => {
  const id = req.session.customer_id;
  const q = await db(req).query(
    `SELECT id, created_at, status, total_amount, payment_status
     FROM orders
     WHERE customer_id=$1
     ORDER BY created_at DESC
     LIMIT 50`,
    [id]
  );
  res.render("customer/orders", { orders: q.rows });
});

// Order detail (status timeline + items only)
router.get("/orders/:id", requireCustomer, async (req, res) => {
  const customerId = req.session.customer_id;
  const orderId = Number(req.params.id);

  const o = await db(req).query(
    "SELECT * FROM orders WHERE id=$1 AND customer_id=$2 LIMIT 1",
    [orderId, customerId]
  );
  if(o.rowCount === 0) return res.redirect("/c/orders");

  const items = await db(req).query(
    `SELECT oi.quantity, oi.price, sp.name AS sub_name, p.name AS product_name
     FROM order_items oi
     JOIN sub_products sp ON sp.id = oi.sub_product_id
     JOIN products p ON p.id = sp.product_id
     WHERE oi.order_id=$1`,
    [orderId]
  );

  res.render("customer/order_detail", { order: o.rows[0], items: items.rows });
});

// New Order entry: shows a "Start Order" screen (black style CTA)
router.get("/new", requireCustomer, (req, res) => {
  res.render("customer/new_start");
});

// Product list with quantity selection
router.get("/products", requireCustomer, async (req, res) => {
  const products = await db(req).query("SELECT id, name FROM products WHERE is_active=true ORDER BY name");
  const subs = await db(req).query(
    "SELECT id, product_id, name, price, unit, is_active FROM sub_products WHERE is_active=true ORDER BY product_id, name"
  );
  res.render("customer/products", { products: products.rows, subs: subs.rows });
});

// Add items to session cart
router.post("/cart/add", requireCustomer, async (req, res) => {
  const cart = req.session.cart || {};
  // body: { items: [{sub_product_id, qty}] }
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  for(const it of items){
    const sid = String(it.sub_product_id || "");
    const qty = Number(it.qty || 0);
    if(!sid || qty <= 0) continue;
    cart[sid] = (cart[sid] || 0) + qty;
  }
  req.session.cart = cart;
  res.redirect("/c/cart");
});

// Cart view
router.get("/cart", requireCustomer, async (req, res) => {
  const cart = req.session.cart || {};
  const ids = Object.keys(cart).map(x => Number(x)).filter(Boolean);

  let rows = [];
  if(ids.length){
    const q = await db(req).query(
      `SELECT sp.id, sp.name AS sub_name, sp.price, sp.unit, p.name AS product_name
       FROM sub_products sp
       JOIN products p ON p.id = sp.product_id
       WHERE sp.id = ANY($1::int[])`,
      [ids]
    );
    rows = q.rows.map(r => ({...r, qty: cart[String(r.id)] || 0, line: (cart[String(r.id)]||0) * Number(r.price) }));
  }

  const itemsTotal = rows.reduce((a,b)=>a + (b.line||0), 0);
  const delivery = itemsTotal >= 200 ? 0 : 10; // example rule
  const total = itemsTotal + delivery;

  res.render("customer/cart", { rows, itemsTotal, delivery, total });
});

// Add to cart from previous order
router.post("/orders/:id/add-to-cart", requireCustomer, async (req, res) => {
  const customerId = req.session.customer_id;
  const orderId = Number(req.params.id);

  const o = await db(req).query("SELECT id FROM orders WHERE id=$1 AND customer_id=$2 LIMIT 1", [orderId, customerId]);
  if(o.rowCount === 0) return res.redirect("/c/orders");

  const items = await db(req).query("SELECT sub_product_id, quantity FROM order_items WHERE order_id=$1", [orderId]);

  const cart = req.session.cart || {};
  for(const it of items.rows){
    const sid = String(it.sub_product_id);
    cart[sid] = (cart[sid] || 0) + Number(it.quantity || 0);
  }
  req.session.cart = cart;
  res.redirect("/c/cart");
});

// Checkout (delivery day today/tomorrow + calendar date)
router.get("/checkout", requireCustomer, async (req, res) => {
  const customerId = req.session.customer_id;
  const c = await db(req).query("SELECT id, name, address, latitude, longitude FROM customers WHERE id=$1", [customerId]);

  const cart = req.session.cart || {};
  const ids = Object.keys(cart).map(x => Number(x)).filter(Boolean);

  let rows = [];
  if(ids.length){
    const q = await db(req).query(
      `SELECT sp.id, sp.name AS sub_name, sp.price, sp.unit, p.name AS product_name
       FROM sub_products sp JOIN products p ON p.id=sp.product_id
       WHERE sp.id = ANY($1::int[])`,
      [ids]
    );
    rows = q.rows.map(r => ({...r, qty: cart[String(r.id)] || 0, line: (cart[String(r.id)]||0) * Number(r.price) }));
  }

  const itemsTotal = rows.reduce((a,b)=>a + (b.line||0), 0);
  const delivery = itemsTotal >= 200 ? 0 : 10;
  const total = itemsTotal + delivery;

  res.render("customer/checkout", { c: c.rows[0], rows, itemsTotal, delivery, total });
});

// Place order
router.post("/place", requireCustomer, async (req, res) => {
  const customerId = req.session.customer_id;
  const cart = req.session.cart || {};
  const ids = Object.keys(cart).map(x => Number(x)).filter(Boolean);
  if(!ids.length) return res.redirect("/c/products");

  const delivery_day = String(req.body.delivery_day || "today");
  const delivery_date = req.body.delivery_date ? String(req.body.delivery_date) : null;
  const payment_method = String(req.body.payment_method || "COD");

  const cust = await db(req).query("SELECT address, latitude, longitude FROM customers WHERE id=$1", [customerId]);

  const q = await db(req).query(
    `SELECT sp.id, sp.price
     FROM sub_products sp
     WHERE sp.id = ANY($1::int[])`,
    [ids]
  );

  const priceMap = new Map(q.rows.map(r => [String(r.id), Number(r.price)]));

  let itemsTotal = 0;
  for(const sid of Object.keys(cart)){
    const qty = Number(cart[sid] || 0);
    const price = priceMap.get(String(sid)) || 0;
    itemsTotal += qty * price;
  }
  const delivery = itemsTotal >= 200 ? 0 : 10;
  const total = itemsTotal + delivery;

  const orderIns = await db(req).query(
    `INSERT INTO orders (customer_id, status, total_amount, delivery_day, delivery_date, payment_method, payment_status, address_snapshot, drop_lat, drop_lng)
     VALUES ($1,'Queue',$2,$3,$4,$5,'UNPAID',$6,$7,$8)
     RETURNING id`,
    [customerId, total, delivery_day, delivery_date, payment_method, cust.rows[0].address, cust.rows[0].latitude, cust.rows[0].longitude]
  );

  const orderId = orderIns.rows[0].id;

  for(const sid of Object.keys(cart)){
    const qty = Number(cart[sid] || 0);
    if(qty<=0) continue;
    const price = priceMap.get(String(sid)) || 0;
    await db(req).query(
      "INSERT INTO order_items (order_id, sub_product_id, quantity, price) VALUES ($1,$2,$3,$4)",
      [orderId, Number(sid), qty, price]
    );
  }

  req.session.cart = {}; // clear
  res.redirect(`/c/orders/${orderId}`);
});

module.exports = router;
