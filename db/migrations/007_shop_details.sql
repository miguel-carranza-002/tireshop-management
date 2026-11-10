-- Shop details printed on quotes, work orders and invoices.
BEGIN;

ALTER TABLE settings
    ADD COLUMN shop_name TEXT NOT NULL DEFAULT 'Tire Shop',
    ADD COLUMN shop_address TEXT,          -- may span lines
    ADD COLUMN shop_phone TEXT,
    ADD COLUMN invoice_footer TEXT DEFAULT 'Thank you for your business!';

COMMIT;
