require("dotenv").config();
const db = require("./db");

(async () => {
  const s = (await db.query("SELECT * FROM settings WHERE id=1")).rows[0];

  const customers = [
    { phone: "919111111111", name: "Rohit", addr: "Sector 21, Noida" },
    { phone: "919222222222", name: "Neha", addr: "Indirapuram, Ghaziabad" },
    { phone: "919333333333", name: "Amit", addr: "MG Road, Gurgaon" },
    { phone: "919444444444", name: "Priya", addr: "DLF Phase 3, Gurgaon" }
  ];

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];

    const cust = (await db.query(
      `
      INSERT INTO customers (phone, name, address_text, stage)
      VALUES ($1,$2,$3,'NONE')
      ON CONFLICT (phone)
      DO UPDATE SET name=EXCLUDED.name, address_text=EXCLUDED.address_text
      RETURNING *
      `,
      [c.phone, c.name, c.addr]
    )).rows[0];

    const qty = i + 1;
    const price = parseFloat(s.today_price_per_unit);
    const subtotal = qty * price;
    const delivery = subtotal >= parseFloat(s.free_delivery_threshold) ? 0 : parseFloat(s.delivery_charge_amount);
    const total = subtotal + delivery;

    await db.query(
      `
      INSERT INTO orders
      (customer_id, qty, unit_label, price_per_unit, subtotal, delivery_charge, total, delivery_day, address_snapshot, status, payment_status, order_status, fulfillment_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'TODAY',$8,'DRAFT','UNPAID','QUEUE','CONFIRMED')
      `,
      [cust.id, qty, s.unit_label, price, subtotal, delivery, total, cust.address_text]
    );
  }

  console.log("✅ 4 test orders created in QUEUE.");
  process.exit(0);
})().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
