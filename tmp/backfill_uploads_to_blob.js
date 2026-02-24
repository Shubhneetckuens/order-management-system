require("dotenv").config();
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { Client } = require("pg");

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
  await c.connect();

  const r = await c.query(`
    SELECT id, image_url
    FROM sub_products
    WHERE (image_blob IS NULL)
      AND image_url IS NOT NULL
      AND image_url LIKE '/uploads/%'
    ORDER BY id ASC
  `);

  console.log("Found rows to backfill:", r.rows.length);

  for (const row of r.rows) {
    const filePath = path.join(process.cwd(), "public", row.image_url.replace(/\//g, path.sep));
    if (!fs.existsSync(filePath)) {
      console.log("Missing file for id", row.id, "->", filePath);
      continue;
    }

    const input = fs.readFileSync(filePath);
    const buf = await sharp(input).rotate().resize(600,600,{fit:"cover"}).jpeg({quality:82}).toBuffer();

    await c.query(
      "UPDATE sub_products SET image_blob=$1, image_mime=$2 WHERE id=$3",
      [buf, "image/jpeg", row.id]
    );

    console.log("Backfilled id", row.id);
  }

  await c.end();
  console.log("✅ backfill done");
})().catch(e=>{ console.error(e); process.exit(1); });
