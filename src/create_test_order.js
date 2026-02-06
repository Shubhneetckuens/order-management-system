require("dotenv").config();
const db = require("./db");

async function main() {
  const c = await db.query(
    "INSERT INTO customers (phone, name, address_text, stage) VALUES ($1,$2,$3,$4) ON CONFLICT (phone) DO UPDATE SET address_text=EXCLUDED.address_text RETURNING *;",
    ["919999999999", "Test Customer", "Test Address, City", "NONE"]
  );

  const cust = c.rows[0];

  const s = (await db.query("SELECT * FROM settings WHERE id=1")).rows[0];

  const qty = 2;
  const price = parseFloat(s.today_price_per_unit);
  const subtotal = qty * price;
  const delivery =
    subtotal >= parseFloat(s.free_delivery_threshold)
      ? 0
      : parseFloat(s.delivery_charge_amount);

  const total = subtotal + delivery;

  await db.query(
    "INSERT INTO orders (customer_id, qty, unit_label, price_per_unit, subtotal, delivery_charge, total, delivery_day, address_snapshot, status, payment_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);",
    [
      cust.id,
      qty,
      s.unit_label,
      price,
      subtotal,
      delivery,
      total,
      "TODAY",
      cust.address_text,
      "DRAFT",
      "UNPAID",
    ]
  );

  console.log("✅ Test order created successfully!");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
