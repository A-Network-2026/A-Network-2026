CREATE TABLE IF NOT EXISTS shared_orders (
  id TEXT PRIMARY KEY,
  seller TEXT NOT NULL,
  buyer TEXT,
  title TEXT NOT NULL,
  amount TEXT NOT NULL,
  due TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('Invited', 'Accepted', 'Shipped', 'Delivered')),
  created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS shared_orders_seller ON shared_orders(seller, created);
CREATE INDEX IF NOT EXISTS shared_orders_buyer ON shared_orders(buyer, created);
