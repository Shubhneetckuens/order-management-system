CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  address_text TEXT,
  stage TEXT DEFAULT 'NONE',
  temp_qty NUMERIC,
  temp_delivery_day TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  product_name TEXT DEFAULT 'Fresh Product',
  today_price_per_unit NUMERIC DEFAULT 200,
  unit_label TEXT DEFAULT 'KG',
  free_delivery_threshold NUMERIC DEFAULT 299,
  delivery_charge_amount NUMERIC DEFAULT 30,
  upi_id TEXT DEFAULT 'yourupi@bank',
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  qty NUMERIC NOT NULL,
  unit_label TEXT NOT NULL,
  price_per_unit NUMERIC NOT NULL,
  subtotal NUMERIC NOT NULL,
  delivery_charge NUMERIC NOT NULL,
  total NUMERIC NOT NULL,
  delivery_day TEXT NOT NULL,

  address_snapshot TEXT NOT NULL,

  status TEXT DEFAULT 'DRAFT',

  payment_status TEXT DEFAULT 'UNPAID',
  payment_method TEXT,
  payment_note TEXT,
  paid_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
