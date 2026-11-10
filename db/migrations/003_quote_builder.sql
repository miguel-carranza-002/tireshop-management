BEGIN;

-- A Tires work item remembers what it was built from, so its generated
-- lines (tires, mount & balance, disposal, valve stems) can be rebuilt
-- when the advisor changes the tire, quantity or options.
ALTER TABLE work_items
    ADD COLUMN title TEXT,
    ADD COLUMN tire_product_id BIGINT REFERENCES products(id) ON DELETE RESTRICT,
    ADD COLUMN tire_quantity INTEGER CHECK (tire_quantity > 0),
    ADD COLUMN old_tires_removed INTEGER CHECK (old_tires_removed >= 0),
    -- Size of customer-supplied tires (drives car/truck and surcharge).
    ADD COLUMN customer_tire_size TEXT;

ALTER TABLE work_items
    ADD CONSTRAINT work_items_tire_config_only_on_tires
        CHECK (
            item_type = 'tires'
            OR (
                tire_product_id IS NULL
                AND tire_quantity IS NULL
                AND old_tires_removed IS NULL
                AND customer_tire_size IS NULL
            )
        ),
    ADD CONSTRAINT work_items_tire_source
        CHECK (
            item_type <> 'tires'
            OR (customer_supplied_tires AND tire_product_id IS NULL AND customer_tire_size IS NOT NULL)
            OR (NOT customer_supplied_tires AND tire_product_id IS NOT NULL)
        ),
    ADD CONSTRAINT work_items_tire_quantity_required
        CHECK (item_type <> 'tires' OR (tire_quantity IS NOT NULL AND old_tires_removed IS NOT NULL));

-- generated: created from the work item's settings and rebuilt with it.
-- price_overridden: the advisor typed a price, so never recalculate it.
ALTER TABLE line_items
    ADD COLUMN generated BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN price_overridden BOOLEAN NOT NULL DEFAULT FALSE;

-- One place for the money math, so every screen shows the same numbers.
-- An amount discount can't exceed the line; percent discounts are capped at 100.
CREATE VIEW line_item_amounts AS
SELECT
    li.id AS line_item_id,
    li.work_item_id,
    gross.amount AS gross,
    discount.amount AS discount,
    gross.amount - discount.amount AS net
FROM line_items AS li
CROSS JOIN LATERAL (
    SELECT ROUND(li.quantity * li.unit_price, 2) AS amount
) AS gross
CROSS JOIN LATERAL (
    SELECT CASE li.discount_type
        WHEN 'amount' THEN LEAST(li.discount_value, gross.amount)
        WHEN 'percent' THEN ROUND(gross.amount * li.discount_value / 100, 2)
        ELSE 0
    END AS amount
) AS discount;

-- Work items marked not performed are left off the totals (and the invoice).
CREATE VIEW ticket_totals AS
SELECT
    t.id AS ticket_id,
    COALESCE(SUM(a.gross), 0) AS gross,
    COALESCE(SUM(a.discount), 0) AS discount,
    COALESCE(SUM(a.net), 0) AS subtotal,
    COALESCE(SUM(a.net) FILTER (WHERE li.taxable), 0) AS taxable_subtotal,
    ROUND(COALESCE(SUM(a.net) FILTER (WHERE li.taxable), 0) * t.tax_rate, 2) AS tax,
    COALESCE(SUM(a.net), 0)
        + ROUND(COALESCE(SUM(a.net) FILTER (WHERE li.taxable), 0) * t.tax_rate, 2) AS total
FROM tickets AS t
LEFT JOIN work_items AS wi
    ON wi.ticket_id = t.id AND wi.status <> 'not_performed'
LEFT JOIN line_items AS li ON li.work_item_id = wi.id
LEFT JOIN line_item_amounts AS a ON a.line_item_id = li.id
GROUP BY t.id;

COMMIT;
