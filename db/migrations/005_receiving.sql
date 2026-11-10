BEGIN;

-- Trace each stock change back to the order or ticket that caused it.
ALTER TABLE inventory_movements
    ADD COLUMN pending_order_id BIGINT REFERENCES pending_orders(id) ON DELETE SET NULL,
    ADD COLUMN ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL;

-- When each order was marked returned or unclaimed.
ALTER TABLE pending_orders
    ADD COLUMN closed_at TIMESTAMPTZ;

CREATE INDEX pending_orders_status_idx ON pending_orders (status, created_at DESC);

COMMIT;
