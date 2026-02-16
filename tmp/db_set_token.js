const { Client } = require('pg');

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await c.connect();

  const u = await c.query(
    "UPDATE customers " +
    "SET login_token='test123', token_expires_at=NOW()+INTERVAL '365 days' " +
    "WHERE id=(SELECT id FROM customers ORDER BY id ASC LIMIT 1) " +
    "RETURNING id, phone, login_token, token_expires_at;"
  );

  console.log('UPDATED:', u.rows[0]);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
