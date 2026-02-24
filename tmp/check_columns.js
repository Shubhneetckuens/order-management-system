require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await c.connect();

  const r = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='sub_products' ORDER BY ordinal_position;"
  );

  console.log(r.rows.map(x => x.column_name));

  await c.end();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
