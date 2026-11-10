-- Price for tires bought for a quote: cost x (1 + markup), at least cost +
-- minimum profit, rounded up to .99. Edited on the Settings screen.
BEGIN;

ALTER TABLE settings
    ADD COLUMN tire_markup_percent NUMERIC(5, 2) NOT NULL DEFAULT 0
        CHECK (tire_markup_percent >= 0 AND tire_markup_percent <= 500),
    ADD COLUMN tire_min_profit NUMERIC(10, 2) NOT NULL DEFAULT 0
        CHECK (tire_min_profit >= 0);

COMMIT;
