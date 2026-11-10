-- Up to three tire options quoted to a customer (cheap / medium / premium),
-- with their prices locked for the quote's guarantee. The Tires item has no
-- tire picked until the customer chooses one.
BEGIN;

-- The size the options are for, while none is picked.
ALTER TABLE work_items ADD COLUMN options_size TEXT;

ALTER TABLE work_items DROP CONSTRAINT work_items_tire_source;
ALTER TABLE work_items ADD CONSTRAINT work_items_tire_source
    CHECK (
        item_type <> 'tires'
        OR (customer_supplied_tires AND tire_product_id IS NULL AND customer_tire_size IS NOT NULL)
        OR (NOT customer_supplied_tires AND tire_product_id IS NOT NULL)
        -- Options quoted, customer hasn't chosen yet.
        OR (NOT customer_supplied_tires AND tire_product_id IS NULL AND options_size IS NOT NULL)
    );

CREATE TABLE tire_options (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    work_item_id BIGINT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 3),
    tier TEXT NOT NULL CHECK (tier IN ('cheap', 'medium', 'premium', 'option')),
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    description TEXT NOT NULL,
    tire_size TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    -- Locked when quoted.
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
    unit_cost NUMERIC(10, 2) CHECK (unit_cost >= 0),
    -- Out the door: tires, mount & balance, disposal and tax.
    total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (work_item_id, position)
);

CREATE INDEX tire_options_work_item_idx ON tire_options (work_item_id);

COMMIT;
