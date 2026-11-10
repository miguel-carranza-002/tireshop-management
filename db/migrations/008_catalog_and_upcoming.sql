-- Supplier tires in the catalog, and planning work that waits on orders.
BEGIN;

-- Where we usually buy it. Copied onto pending orders as the vendor.
ALTER TABLE products ADD COLUMN supplier TEXT;

-- When the advisor expects to do the work (a soft appointment). NULL = when
-- the orders arrive.
ALTER TABLE tickets ADD COLUMN planned_for DATE;

COMMIT;
