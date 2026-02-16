-- Customer UI additions (run manually in Postgres)
-- Adds: login token + lat/lng + order snapshot fields (safe defaults)

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS login_token TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS address_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS drop_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS drop_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_day TEXT,
  ADD COLUMN IF NOT EXISTS delivery_date DATE,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_customers_login_token ON customers(login_token);
