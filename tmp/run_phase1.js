const fs = require("fs");
const { Client } = require("pg");

(async () => {
  const sql = fs.readFileSync("./src/migrations/phase1.sql", "utf8").replace(/^\uFEFF/, "");

  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await c.connect();
  await c.query(sql);
  console.log("✅ phase1.sql applied");
  await c.end();
})().catch(e => { console.error("❌", e); process.exit(1); });
