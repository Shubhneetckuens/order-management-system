require("dotenv").config();
const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
  await c.connect();
  const r = await c.query("SELECT id, name, (image_blob IS NOT NULL) AS has_blob, image_mime FROM sub_products ORDER BY id DESC LIMIT 10;");
  console.log(r.rows);
  await c.end();
})().catch(e=>{ console.error(e); process.exit(1); });
