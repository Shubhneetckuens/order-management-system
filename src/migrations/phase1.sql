ALTER TABLE orders
ADD COLUMN IF NOT EXISTS order_status TEXT DEFAULT 'QUEUE';

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS fulfillment_status TEXT DEFAULT 'CONFIRMED';

UPDATE orders
SET order_status =
  CASE
    WHEN status='DRAFT' THEN 'QUEUE'
    WHEN status='APPROVED' THEN 'ACTIVE'
    WHEN status='DELIVERED' THEN 'CLOSED'
    WHEN status='REJECTED' THEN 'REJECTED'
    ELSE 'QUEUE'
  END;

UPDATE orders
SET fulfillment_status =
  CASE
    WHEN order_status='ACTIVE' THEN 'CONFIRMED'
    WHEN order_status='CLOSED' THEN 'DELIVERED'
    ELSE 'CONFIRMED'
  END;