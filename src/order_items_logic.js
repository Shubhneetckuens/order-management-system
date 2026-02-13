const db = require("./db");

async function recalcOrderTotals(orderId) {
  // sum items
  const sum = (await db.query(
    `SELECT COALESCE(SUM(subtotal),0) AS items_subtotal
     FROM order_items
     WHERE order_id=$1`,
    [orderId]
  )).rows[0];

  const itemsSubtotal = parseFloat(sum.items_subtotal || 0);

  const settings = (await db.query("SELECT * FROM settings WHERE id=1")).rows[0];
  const freeThreshold = parseFloat(settings.free_delivery_threshold || 0);
  const deliveryCharge = itemsSubtotal >= freeThreshold ? 0 : parseFloat(settings.delivery_charge_amount || 0);

  const itemsTotal = itemsSubtotal + deliveryCharge;

  await db.query(
    `UPDATE orders
     SET items_subtotal=$1,
         delivery_charge=$2,
         items_total=$3,
         subtotal=$1,
         total=$3,
         updated_at=NOW()
     WHERE id=$4`,
    [itemsSubtotal, deliveryCharge, itemsTotal, orderId]
  );

  return { itemsSubtotal, deliveryCharge, itemsTotal };
}

module.exports = { recalcOrderTotals };
