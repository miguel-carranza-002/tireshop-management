-- Tire catalog: tire lines (brand + model, shared by every size) and the
-- per-size specs on products. Cost and price may be blank so the catalog can
-- hold tires that are neither stocked nor priced yet.
BEGIN;

CREATE TABLE tire_lines (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    brand TEXT NOT NULL CHECK (LENGTH(TRIM(brand)) > 0),
    model TEXT NOT NULL CHECK (LENGTH(TRIM(model)) > 0),
    season TEXT CHECK (season IN (
        'all_season', 'all_weather', 'summer', 'winter', 'highway', 'all_terrain', 'mud_terrain'
    )),
    warranty_miles INTEGER CHECK (warranty_miles >= 0 AND warranty_miles <= 200000),
    run_flat BOOLEAN NOT NULL DEFAULT FALSE,
    ev_rated BOOLEAN NOT NULL DEFAULT FALSE,
    -- Three-peak mountain snowflake: passed a snow traction test (not just M+S).
    severe_snow BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX tire_lines_brand_model_idx ON tire_lines (LOWER(brand), LOWER(model));

-- One tread photo per line, resized on upload. Kept in the database so the
-- nightly backup covers it.
CREATE TABLE tire_line_photos (
    tire_line_id BIGINT PRIMARY KEY REFERENCES tire_lines(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    data BYTEA NOT NULL CHECK (OCTET_LENGTH(data) <= 2000000),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE products
    ADD COLUMN tire_line_id BIGINT REFERENCES tire_lines(id) ON DELETE RESTRICT,
    ADD COLUMN load_index INTEGER CHECK (load_index BETWEEN 60 AND 160),
    -- LT tires carry a dual rating (121/118): the second number.
    ADD COLUMN load_index_dual INTEGER CHECK (load_index_dual BETWEEN 60 AND 160),
    ADD COLUMN speed_rating TEXT
        CHECK (speed_rating IN ('L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'H', 'V', 'W', 'Y', 'Z')),
    ADD COLUMN load_range TEXT CHECK (load_range IN ('B', 'C', 'D', 'E', 'F', 'G', 'H')),
    ADD COLUMN extra_load BOOLEAN NOT NULL DEFAULT FALSE,
    -- When the cost was last entered, so an old cost can be shown as old.
    ADD COLUMN cost_updated_at TIMESTAMPTZ,
    ADD CONSTRAINT products_tire_has_line CHECK (product_type <> 'tire' OR tire_line_id IS NOT NULL) NOT VALID;

ALTER TABLE products ALTER COLUMN cost DROP NOT NULL;
ALTER TABLE products ALTER COLUMN price DROP NOT NULL;

-- Every existing tire gets the line for its brand and model.
INSERT INTO tire_lines (brand, model)
SELECT DISTINCT ON (LOWER(brand), LOWER(model)) brand, model
FROM products
WHERE product_type = 'tire'
ORDER BY LOWER(brand), LOWER(model), id;

UPDATE products p
SET tire_line_id = l.id, cost_updated_at = p.updated_at
FROM tire_lines l
WHERE p.product_type = 'tire' AND LOWER(l.brand) = LOWER(p.brand) AND LOWER(l.model) = LOWER(p.model);

ALTER TABLE products VALIDATE CONSTRAINT products_tire_has_line;

CREATE INDEX products_tire_line_idx ON products (tire_line_id);

COMMIT;
