
BEGIN;

-- The catalog describes each type of tire the shop sells.
CREATE TABLE products (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku TEXT NOT NULL,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    tire_size TEXT NOT NULL,
    cost NUMERIC(10, 2) NOT NULL CHECK (cost >= 0),
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (LENGTH(TRIM(sku)) > 0),
    CHECK (LENGTH(TRIM(brand)) > 0),
    CHECK (LENGTH(TRIM(model)) > 0),
    CHECK (LENGTH(TRIM(tire_size)) > 0)
);

-- Treat SKU values as unique regardless of letter case.
CREATE UNIQUE INDEX products_sku_unique_idx
    ON products (LOWER(sku));

-- One stock record per product.
CREATE TABLE inventory_stock (
    product_id BIGINT PRIMARY KEY
        REFERENCES products(id) ON DELETE RESTRICT,
    on_hand_qty INTEGER NOT NULL DEFAULT 0
        CHECK (on_hand_qty >= 0),
    reserved_qty INTEGER NOT NULL DEFAULT 0
        CHECK (reserved_qty >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (reserved_qty <= on_hand_qty)
);

-- Record physical changes to stock, not reservations themselves.
CREATE TABLE inventory_movements (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id BIGINT NOT NULL
        REFERENCES products(id) ON DELETE RESTRICT,
    movement_type TEXT NOT NULL
        CHECK (
            movement_type IN (
                'receipt',
                'consumption',
                'adjustment',
                'return'
            )
        ),
    quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX inventory_movements_product_created_idx
    ON inventory_movements (product_id, created_at DESC);

COMMIT;
