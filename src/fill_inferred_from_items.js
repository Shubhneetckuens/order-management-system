require("dotenv").config();
const db = require("./db");

(async () => {
  const orders = (await db.query(`
    SELECT id, address_snapshot, delivery_day
    FROM orders
    ORDER BY id ASC
  `)).rows;

  let updated = 0;

  for (const o of orders) {
    const sums = (await db.query(`
      SELECT
        COALESCE(SUM(qty),0) AS qty_sum,
        COALESCE(SUM(subtotal),0) AS sub_sum
      FROM order_items
      WHERE order_id=$1
    `, [o.id])).rows[0];

    const qtySum = parseFloat(sums.qty_sum || 0);
    const subSum = parseFloat(sums.sub_sum || 0);

    // delivery charge is already computed on the order (recalcOrderTotals did that)
    const ord = (await db.query(`
      SELECT delivery_charge, items_total
      FROM orders
      WHERE id=$1
    `, [o.id])).rows[0];

    const delivery = parseFloat((ord && ord.delivery_charge) || 0);
    const total = parseFloat((ord && ord.items_total) || 0);

    await db.query(`
      UPDATE orders
      SET
        inferred_qty = $1,
        inferred_price_per_unit = 0,
        inferred_subtotal = $2,
        inferred_delivery_charge = $3,
        inferred_total = $4,
        inferred_delivery_day = $5,
        inferred_address_snapshot = $6,
        updated_at = NOW()
      WHERE id = $7
    `, [qtySum, subSum, delivery, total, o.delivery_day || "TODAY", o.address_snapshot || "", o.id]);

    updated++;
  }

  console.log("✅ Inferred fields filled for orders:", updated);
  process.exit(0);
})().catch(e => { console.error("❌", e.message); process.exit(1); });
