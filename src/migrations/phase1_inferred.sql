ALTER TABLE orders
ADD COLUMN IF NOT EXISTS inferred_qty NUMERIC,
ADD COLUMN IF NOT EXISTS inferred_price_per_unit NUMERIC,
ADD COLUMN IF NOT EXISTS inferred_subtotal NUMERIC,
ADD COLUMN IF NOT EXISTS inferred_delivery_charge NUMERIC,
ADD COLUMN IF NOT EXISTS inferred_total NUMERIC,
ADD COLUMN IF NOT EXISTS inferred_delivery_day TEXT,
ADD COLUMN IF NOT EXISTS inferred_address_snapshot TEXT;

-- Fill inferred fields for existing records where null
UPDATE orders
SET
  inferred_qty = COALESCE(inferred_qty, qty),
  inferred_price_per_unit = COALESCE(inferred_price_per_unit, price_per_unit),
  inferred_subtotal = COALESCE(inferred_subtotal, subtotal),
  inferred_delivery_charge = COALESCE(inferred_delivery_charge, delivery_charge),
  inferred_total = COALESCE(inferred_total, total),
  inferred_delivery_day = COALESCE(inferred_delivery_day, delivery_day),
  inferred_address_snapshot = COALESCE(inferred_address_snapshot, address_snapshot)
WHERE inferred_qty IS NULL
   OR inferred_address_snapshot IS NULL
   OR inferred_total IS NULL;