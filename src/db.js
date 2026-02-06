const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && (
      process.env.DATABASE_URL.includes("railway") ||
      process.env.DATABASE_URL.includes("render")  ||
      process.env.DATABASE_URL.includes("neon")    ||
      process.env.DATABASE_URL.includes("supabase")
    )
    ? { rejectUnauthorized: false }
    : false,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
