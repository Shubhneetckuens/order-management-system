require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL missing in .env");
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("railway") ? { rejectUnauthorized: false } : false,
  });

  const sqlPath = path.join(__dirname, "schema.sql");
  let sql = fs.readFileSync(sqlPath, "utf8");

  // ✅ Remove UTF-8 BOM if present
  sql = sql.replace(/^\uFEFF/, "");

  console.log("🔌 Connecting to DB...");
  await client.connect();

  console.log("🧱 Running schema.sql...");
  await client.query(sql);

  console.log("✅ Tables created.");

  console.log("⚙️ Updating settings row...");
  await client.query(`
    UPDATE settings
    SET
      product_name='Mushroom',
      today_price_per_unit=200,
      unit_label='KG',
      free_delivery_threshold=299,
      delivery_charge_amount=30,
      upi_id='yourupi@bank'
    WHERE id=1;
  `);

  console.log("✅ Settings updated.");

  const res = await client.query("SELECT * FROM settings WHERE id=1;");
  console.log("✅ Current settings:", res.rows[0]);

  await client.end();
  console.log("🎉 Migration done.");
}

main().catch((err) => {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
});
