-- Each TPMS sensor line keeps the single and 2+ prices from when it was
-- added, so changing Settings later never re-prices an existing ticket.
ALTER TABLE line_items
    ADD COLUMN tpms_single_price NUMERIC(10, 2),
    ADD COLUMN tpms_multi_price NUMERIC(10, 2);

-- Lines already on tickets: today's Settings, the prices they were set from.
UPDATE line_items
SET tpms_single_price = s.tpms_sensor_single_price,
    tpms_multi_price = s.tpms_sensor_multi_price
FROM settings s
WHERE line_items.service_code = 'tpms_sensor';

ALTER TABLE line_items
    ADD CONSTRAINT line_items_tpms_prices_check
    CHECK (service_code IS DISTINCT FROM 'tpms_sensor' OR (tpms_single_price IS NOT NULL AND tpms_multi_price IS NOT NULL));
