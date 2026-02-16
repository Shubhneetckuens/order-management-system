const { Client } = require('pg');

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await c.connect();
  const r = await c.query('SELECT id, phone, name, login_token, token_expires_at, address_text FROM customers ORDER BY id ASC LIMIT 5;');
  console.log(r.rows);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
