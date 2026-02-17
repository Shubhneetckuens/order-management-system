const { Client } = require("pg");

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized:false } });
  await c.connect();
  await c.query("ALTER TABLE sub_products ADD COLUMN IF NOT EXISTS image_url TEXT;");
  console.log("✅ sub_products.image_url added");
  await c.end();
})().catch(e=>{ console.error("❌", e); process.exit(1); });
