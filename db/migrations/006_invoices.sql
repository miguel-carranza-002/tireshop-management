-- Step 7: invoices, payments and accounts.
BEGIN;

-- A cancelled non-returnable special order keeps the deposit. The amount kept
-- is recorded at invoicing so the balance closes at zero.
ALTER TABLE tickets
    ADD COLUMN deposit_kept NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (deposit_kept >= 0),
    ADD COLUMN charged_to_account BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT tickets_paid_only_invoiced CHECK (paid_at IS NULL OR status = 'invoiced'),
    ADD CONSTRAINT tickets_account_only_invoiced CHECK (NOT charged_to_account OR status = 'invoiced');

CREATE INDEX tickets_unpaid_idx ON tickets (customer_id)
    WHERE status = 'invoiced' AND paid_at IS NULL;

-- What the customer owes on a ticket, after deposits, payments and refunds.
--   charges = ticket total + return fees on returned special orders + deposit kept
--   paid    = deposits + payments - refunds
CREATE VIEW ticket_balances AS
SELECT
    t.id AS ticket_id,
    tt.total,
    COALESCE(fees.return_fees, 0) AS return_fees,
    t.deposit_kept,
    tt.total + COALESCE(fees.return_fees, 0) + t.deposit_kept AS charges,
    COALESCE(p.deposits, 0) AS deposits,
    COALESCE(p.payments, 0) AS payments,
    COALESCE(p.refunds, 0) AS refunds,
    COALESCE(p.deposits, 0) + COALESCE(p.payments, 0) - COALESCE(p.refunds, 0) AS paid,
    tt.total + COALESCE(fees.return_fees, 0) + t.deposit_kept
        - (COALESCE(p.deposits, 0) + COALESCE(p.payments, 0) - COALESCE(p.refunds, 0)) AS balance
FROM tickets AS t
JOIN ticket_totals AS tt ON tt.ticket_id = t.id
LEFT JOIN (
    SELECT ticket_id, SUM(return_fee) AS return_fees
    FROM pending_orders
    WHERE status = 'returned' AND ticket_id IS NOT NULL
    GROUP BY ticket_id
) AS fees ON fees.ticket_id = t.id
LEFT JOIN (
    SELECT
        ticket_id,
        SUM(amount) FILTER (WHERE payment_kind = 'deposit') AS deposits,
        SUM(amount) FILTER (WHERE payment_kind = 'payment') AS payments,
        SUM(amount) FILTER (WHERE payment_kind = 'refund') AS refunds
    FROM payments
    GROUP BY ticket_id
) AS p ON p.ticket_id = t.id;

COMMIT;
