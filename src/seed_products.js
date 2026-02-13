require("dotenv").config();
const db = require("./db");

(async () => {
  // Product 1: Mushrooms
  const p1 = (await db.query(
    `INSERT INTO products (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name
     RETURNING *`,
    ["Mushrooms"]
  )).rows[0];

  const variants = [
    { name: "Button Mushroom", price: 200, unit: "KG" },
    { name: "Oyster Mushroom", price: 220, unit: "KG" },
    { name: "Milky Mushroom", price: 240, unit: "KG" }
  ];

  for (const v of variants) {
    await db.query(
      `INSERT INTO sub_products (product_id, name, price_per_unit, unit_label)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (product_id, name)
       DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit, unit_label=EXCLUDED.unit_label`,
      [p1.id, v.name, v.price, v.unit]
    );
  }

  console.log("✅ Seeded products + sub-products");
  process.exit(0);
})().catch(e => { console.error("❌", e.message); process.exit(1); });
