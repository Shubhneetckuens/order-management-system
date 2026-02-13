require("dotenv").config();
const db = require("./db");
const { recalcOrderTotals } = require("./order_items_logic");

(async () => {
  const subs = (await db.query(`
    SELECT sp.*, p.name AS product_name
    FROM sub_products sp
    JOIN products p ON p.id=sp.product_id
    WHERE sp.is_active=TRUE AND p.is_active=TRUE
    ORDER BY sp.id ASC
  `)).rows;

  if (!subs.length) throw new Error("No active sub-products found. Add from Product Master first.");

  const customers = [
    { phone: "919111111111", name: "Rohit", addr: "Sector 21, Noida" },
    { phone: "919222222222", name: "Neha", addr: "Indirapuram, Ghaziabad" },
    { phone: "919333333333", name: "Amit", addr: "MG Road, Gurgaon" },
    { phone: "919444444444", name: "Priya", addr: "DLF Phase 3, Gurgaon" },
    { phone: "919555555555", name: "Sahil", addr: "Raj Nagar, Ghaziabad" },
    { phone: "919666666666", name: "Anjali", addr: "Mayur Vihar, Delhi" },
    { phone: "919777777777", name: "Karan", addr: "Saket, Delhi" },
    { phone: "919888888888", name: "Meera", addr: "Dwarka, Delhi" }
  ];

  const statuses = [
    { order_status: "QUEUE", status: "DRAFT", fulfillment_status: "CONFIRMED", payment_status: "UNPAID" },
    { order_status: "QUEUE", status: "DRAFT", fulfillment_status: "CONFIRMED", payment_status: "UNPAID" },
    { order_status: "QUEUE", status: "DRAFT", fulfillment_status: "CONFIRMED", payment_status: "UNPAID" },
    { order_status: "ACTIVE", status: "APPROVED", fulfillment_status: "CONFIRMED", payment_status: "UNPAID" },
    { order_status: "ACTIVE", status: "APPROVED", fulfillment_status: "DISPATCHED", payment_status: "PAID" },
    { order_status: "ACTIVE", status: "APPROVED", fulfillment_status: "DELIVERED", payment_status: "PAID" },
    { order_status: "CLOSED", status: "DELIVERED", fulfillment_status: "DELIVERED", payment_status: "PAID" },
    { order_status: "REJECTED", status: "REJECTED", fulfillment_status: "CONFIRMED", payment_status: "UNPAID" }
  ];

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];

    const cust = (await db.query(
      `
      INSERT INTO customers (phone, name, address_text, stage)
      VALUES ($1,$2,$3,'NONE')
      ON CONFLICT (phone) DO UPDATE SET name=EXCLUDED.name, address_text=EXCLUDED.address_text
      RETURNING *
      `,
      [c.phone, c.name, c.addr]
    )).rows[0];

    const st = statuses[i];

    const order = (await db.query(
      `
      INSERT INTO orders
      (customer_id, qty, unit_label, price_per_unit, subtotal, delivery_charge, total,
       delivery_day, address_snapshot, status, payment_status, order_status, fulfillment_status)
      VALUES
      ($1,0,'KG',0,0,0,0,'TODAY',$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [cust.id, cust.address_text, st.status, st.payment_status, st.order_status, st.fulfillment_status]
    )).rows[0];

    // add 2 items each
    const pick1 = subs[i % subs.length];
    const pick2 = subs[(i + 1) % subs.length];

    const qty1 = (i % 3) + 1;        // 1-3
    const qty2 = (i % 2) + 0.5;      // 0.5-1.5

    const p1 = parseFloat(pick1.price_per_unit || 0);
    const p2 = parseFloat(pick2.price_per_unit || 0);

    await db.query(
      `
      INSERT INTO order_items (order_id, sub_product_id, qty, price_per_unit, subtotal)
      VALUES ($1,$2,$3,$4,$5)
      `,
      [order.id, pick1.id, qty1, p1, qty1 * p1]
    );

    await db.query(
      `
      INSERT INTO order_items (order_id, sub_product_id, qty, price_per_unit, subtotal)
      VALUES ($1,$2,$3,$4,$5)
      `,
      [order.id, pick2.id, qty2, p2, qty2 * p2]
    );

    await recalcOrderTotals(order.id);
  }

  console.log("✅ 8 fresh test orders created (Queue, Active, Closed, Rejected) with items.");
  process.exit(0);
})().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
