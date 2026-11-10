BEGIN;

-- Why a special order was accepted without the usual deposit.
ALTER TABLE tickets
    ADD COLUMN deposit_override_reason TEXT;

-- Find a product's open restock order quickly (customer portions have a ticket).
CREATE INDEX pending_orders_open_restock_idx
    ON pending_orders (product_id)
    WHERE ticket_id IS NULL AND status IN ('needed', 'ordered');

CREATE INDEX pending_orders_line_idx ON pending_orders (line_item_id);
CREATE INDEX reservations_product_idx ON reservations (product_id);

COMMIT;
