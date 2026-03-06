const db = require("./db");
const { sendWhatsAppText } = require("./whatsapp");

function isNumber(str) {
  return /^[0-9]+(\.[0-9]+)?$/.test((str || "").trim());
}

async function getSettings() {
  const res = await db.query("SELECT * FROM settings WHERE id=1");
  return res.rows[0];
}

async function getOrCreateCustomer(phone) {
  const found = await db.query("SELECT * FROM customers WHERE phone=$1", [phone]);
  if (found.rows[0]) return found.rows[0];

  const created = await db.query(
    "INSERT INTO customers (phone, stage) VALUES ($1, 'ASK_QTY') RETURNING *",
    [phone]
  );
  return created.rows[0];
}

async function handleIncomingMessage(phone, textRaw) {
  const text = (textRaw || "").trim();

  // Debug reset
  if (text.toLowerCase() === "reset") {
    await db.query(
      "UPDATE customers SET stage='ASK_QTY', temp_qty=NULL, temp_delivery_day=NULL WHERE phone=$1",
      [phone]
    );
    await sendWhatsAppText(phone, "Reset ✅ Now tell quantity (number only).");
    return;
  }

  const settings = await getSettings();
  const productName = settings.product_name;
  const unitLabel = settings.unit_label;

  let customer = await getOrCreateCustomer(phone);
  const stage = customer.stage || "NONE";

  // Start flow on HI
  if (
    stage === "NONE" &&
    (text === "" || text.toLowerCase() === "hi" || text.toLowerCase() === "hello")
  ) {
    await db.query("UPDATE customers SET stage='ASK_QTY' WHERE phone=$1", [phone]);
    await sendWhatsAppText(
      phone,
      `Hi 👋 How many ${unitLabel} of *${productName}* do you want? (Example: 2)`
    );
    return;
  }

  if (stage === "NONE") {
    await db.query("UPDATE customers SET stage='ASK_QTY' WHERE phone=$1", [phone]);
    await sendWhatsAppText(
      phone,
      `How many ${unitLabel} of *${productName}* do you want? (Example: 2)`
    );
    return;
  }

  if (stage === "ASK_QTY") {
    if (!isNumber(text)) {
      await sendWhatsAppText(phone, `Please send only number in ${unitLabel} (Example: 2 or 1.5).`);
      return;
    }

    const qty = parseFloat(text);

    await db.query(
      "UPDATE customers SET temp_qty=$1, stage='ASK_ADDRESS', updated_at=NOW() WHERE phone=$2",
      [qty, phone]
    );

    await sendWhatsAppText(phone, "✅ Got it. Now send your full delivery address.");
    return;
  }

  if (stage === "ASK_ADDRESS") {
    if (text.length < 10) {
      await sendWhatsAppText(phone, "Please send full address (House/Shop, Area, Landmark).");
      return;
    }

    await db.query(
      "UPDATE customers SET address_text=$1, stage='ASK_DAY', updated_at=NOW() WHERE phone=$2",
      [text, phone]
    );

    await sendWhatsAppText(phone, "Delivery: reply *1* for *TODAY* or *2* for *TOMORROW*.");
    return;
  }

  if (stage === "ASK_DAY") {
    let day = null;
    if (text === "1") day = "TODAY";
    if (text === "2") day = "TOMORROW";

    if (!day) {
      await sendWhatsAppText(phone, "Reply *1* for TODAY or *2* for TOMORROW.");
      return;
    }

    // Reload customer fresh
    customer = (await db.query("SELECT * FROM customers WHERE phone=$1", [phone])).rows[0];

    const qty = parseFloat(customer.temp_qty);
    const price = parseFloat(settings.today_price_per_unit);

    const subtotal = qty * price;
    const deliveryCharge =
      subtotal >= parseFloat(settings.free_delivery_threshold)
        ? 0
        : parseFloat(settings.delivery_charge_amount);

    const total = subtotal + deliveryCharge;

    await db.query(
      `INSERT INTO orders
        (customer_id, qty, unit_label, price_per_unit, subtotal, delivery_charge, total, delivery_day, address_snapshot, status, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT','UNPAID')`,
      [
        customer.id,
        qty,
        unitLabel,
        price,
        subtotal,
        deliveryCharge,
        total,
        day,
        customer.address_text,
      ]
    );

    await db.query(
      "UPDATE customers SET temp_delivery_day=$1, stage='CONFIRM', updated_at=NOW() WHERE phone=$2",
      [day, phone]
    );

    await sendWhatsAppText(
      phone,
      `🧾 *Order Summary*\n\n*${productName}*: ${qty} ${unitLabel}\nPrice: ₹${price}/${unitLabel}\nSubtotal: ₹${subtotal}\nDelivery: ₹${deliveryCharge}\n*Total: ₹${total}*\nDelivery: *${day}*\n\nReply *YES* to confirm or *NO* to cancel.`
    );

    return;
  }

  if (stage === "CONFIRM") {
    const ans = text.toLowerCase();

    const latest = await db.query(
      `SELECT o.*, c.phone
       FROM orders o
       JOIN customers c ON c.id=o.customer_id
       WHERE c.phone=$1
       ORDER BY o.created_at DESC
       LIMIT 1`,
      [phone]
    );
    const order = latest.rows[0];

    if (!order) {
      await db.query("UPDATE customers SET stage='ASK_QTY' WHERE phone=$1", [phone]);
      await sendWhatsAppText(phone, "Something went wrong. Start again: send quantity.");
      return;
    }

    if (ans === "yes") {
      await db.query("UPDATE orders SET status='APPROVED', updated_at=NOW() WHERE id=$1", [
        order.id,
      ]);

      await sendWhatsAppText(
        phone,
        `✅ *Order Approved!*\nDelivery: *${order.delivery_day}*\nTotal: ₹${order.total}\n\nPay via UPI: ${settings.upi_id}\nOr Cash on delivery.`
      );

      await db.query(
        "UPDATE customers SET stage='NONE', temp_qty=NULL, temp_delivery_day=NULL WHERE phone=$1",
        [phone]
      );
      return;
    }

    if (ans === "no") {
      await db.query("UPDATE orders SET status='REJECTED', updated_at=NOW() WHERE id=$1", [
        order.id,
      ]);

      await sendWhatsAppText(phone, "❌ Order cancelled. Thank you.");

      await db.query(
        "UPDATE customers SET stage='NONE', temp_qty=NULL, temp_delivery_day=NULL WHERE phone=$1",
        [phone]
      );
      return;
    }

    await sendWhatsAppText(phone, "Reply *YES* to confirm or *NO* to cancel.");
    return;
  }

  // Fallback
  await db.query("UPDATE customers SET stage='ASK_QTY' WHERE phone=$1", [phone]);
  await sendWhatsAppText(phone, `Let’s start again. How many ${unitLabel} do you want?`);
}

module.exports = { handleIncomingMessage };
