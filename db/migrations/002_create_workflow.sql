BEGIN;

-- ---------------------------------------------------------------------------
-- Settings: a single row holding every configurable price, rate and time.
-- Prices start at 0: each shop enters its own on the Settings screen.
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),

    products_tax_rate NUMERIC(6, 5) NOT NULL DEFAULT 0
        CHECK (products_tax_rate >= 0 AND products_tax_rate < 1),
    shop_rate_per_hour NUMERIC(10, 2) NOT NULL DEFAULT 0
        CHECK (shop_rate_per_hour >= 0),

    alignment_car_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    alignment_truck_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    alignment_surcharge NUMERIC(10, 2) NOT NULL DEFAULT 0,

    mount_balance_car_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    mount_balance_truck_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    mount_balance_surcharge NUMERIC(10, 2) NOT NULL DEFAULT 0,

    disposal_fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
    valve_stem_customer_supplied_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    trailer_valve_stem_price NUMERIC(10, 2) NOT NULL DEFAULT 0,

    tpms_sensor_single_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    tpms_sensor_multi_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    tpms_reset_price NUMERIC(10, 2) NOT NULL DEFAULT 0,

    used_tire_car_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    used_tire_truck_price NUMERIC(10, 2) NOT NULL DEFAULT 0,

    min_deposit NUMERIC(10, 2) NOT NULL DEFAULT 0,
    quote_valid_days INTEGER NOT NULL DEFAULT 7 CHECK (quote_valid_days > 0),

    alignment_minutes INTEGER NOT NULL DEFAULT 30 CHECK (alignment_minutes > 0),
    tire_job_car_minutes INTEGER NOT NULL DEFAULT 30 CHECK (tire_job_car_minutes > 0),
    tire_job_truck_minutes INTEGER NOT NULL DEFAULT 40 CHECK (tire_job_truck_minutes > 0),
    tire_job_min_minutes INTEGER NOT NULL DEFAULT 15 CHECK (tire_job_min_minutes > 0),

    low_profile_max_aspect INTEGER NOT NULL DEFAULT 45,
    oversized_min_diameter_in NUMERIC(5, 2) NOT NULL DEFAULT 33,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO settings DEFAULT VALUES;

-- ---------------------------------------------------------------------------
-- Products: stocked items are tires and TPMS sensors. Rims, mechanic parts
-- and one-offs are free-text lines and never live here.
-- ---------------------------------------------------------------------------
ALTER TABLE products
    ADD COLUMN product_type TEXT NOT NULL DEFAULT 'tire'
        CHECK (product_type IN ('tire', 'tpms_sensor')),
    ADD COLUMN condition TEXT NOT NULL DEFAULT 'new'
        CHECK (condition IN ('new', 'used')),
    ADD COLUMN stocked BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN min_qty INTEGER NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
    -- NULL = derive car/truck from tire_size; set to override.
    ADD COLUMN tire_class_override TEXT
        CHECK (tire_class_override IN ('car', 'truck'));

ALTER TABLE products ALTER COLUMN tire_size DROP NOT NULL;

ALTER TABLE products
    ADD CONSTRAINT products_tire_requires_size
        CHECK (product_type <> 'tire' OR tire_size IS NOT NULL),
    -- Used tires are never restocked to a minimum.
    ADD CONSTRAINT products_used_no_min
        CHECK (condition = 'new' OR min_qty = 0);

ALTER TABLE inventory_movements
    DROP CONSTRAINT inventory_movements_movement_type_check;

ALTER TABLE inventory_movements
    ADD CONSTRAINT inventory_movements_movement_type_check
        CHECK (
            movement_type IN (
                'receipt',
                'consumption',
                'adjustment',
                'return',
                'return_to_vendor',
                'unclaimed'
            )
        );

-- ---------------------------------------------------------------------------
-- Customers & vehicles
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name TEXT NOT NULL CHECK (LENGTH(TRIM(first_name)) > 0),
    last_name TEXT,
    phone TEXT,
    has_account BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phone is intentionally not unique: duplicates warn in the app.
CREATE INDEX customers_first_name_idx ON customers (LOWER(first_name));
CREATE INDEX customers_last_name_idx ON customers (LOWER(last_name));
CREATE INDEX customers_phone_idx ON customers (phone);

CREATE TABLE vehicles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    year INTEGER NOT NULL CHECK (year BETWEEN 1900 AND 2100),
    make TEXT NOT NULL CHECK (LENGTH(TRIM(make)) > 0),
    model TEXT NOT NULL CHECK (LENGTH(TRIM(model)) > 0),
    vehicle_class TEXT NOT NULL DEFAULT 'car'
        CHECK (vehicle_class IN ('car', 'truck')),
    lifted_lowered BOOLEAN NOT NULL DEFAULT FALSE,
    multi_link_suspension BOOLEAN NOT NULL DEFAULT FALSE,
    license_plate TEXT,
    vin TEXT,
    tire_size TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Lets tickets prove their vehicle belongs to their customer.
    UNIQUE (id, customer_id)
);

CREATE INDEX vehicles_customer_idx ON vehicles (customer_id);

-- ---------------------------------------------------------------------------
-- Tickets: one record that is a quote, then a work order, then an invoice.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE quote_number_seq START 1001;

-- Gap-free invoice numbers: bump this row inside the invoicing transaction
-- (UPDATE ... RETURNING) instead of using a sequence, which can skip values.
CREATE TABLE invoice_counter (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    last_number INTEGER NOT NULL
);

INSERT INTO invoice_counter (last_number) VALUES (5000);

CREATE TABLE tickets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    quote_number INTEGER NOT NULL UNIQUE DEFAULT nextval('quote_number_seq'),
    invoice_number INTEGER UNIQUE,
    customer_id BIGINT NOT NULL,
    vehicle_id BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'quote'
        CHECK (status IN ('quote', 'declined', 'work_order', 'invoiced')),

    -- Snapshot of the tax rate so later setting changes don't move totals.
    tax_rate NUMERIC(6, 5) NOT NULL,
    valid_until DATE NOT NULL,

    accepted_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    checked_in_at TIMESTAMPTZ,
    invoiced_at TIMESTAMPTZ,
    -- NULL on an invoice = charged to account and still owed.
    paid_at TIMESTAMPTZ,

    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (vehicle_id, customer_id)
        REFERENCES vehicles (id, customer_id) ON DELETE RESTRICT,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,

    CHECK ((status = 'invoiced') = (invoice_number IS NOT NULL)),
    CHECK ((status = 'invoiced') = (invoiced_at IS NOT NULL)),
    CHECK (checked_in_at IS NULL OR status IN ('work_order', 'invoiced'))
);

ALTER SEQUENCE quote_number_seq OWNED BY tickets.quote_number;

CREATE INDEX tickets_customer_idx ON tickets (customer_id);
CREATE INDEX tickets_status_idx ON tickets (status);
CREATE INDEX tickets_open_accounts_idx ON tickets (customer_id)
    WHERE status = 'invoiced' AND paid_at IS NULL;

CREATE TABLE work_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL
        CHECK (item_type IN ('tires', 'alignment', 'mechanic', 'other')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'not_performed')),
    not_performed_reason TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,

    -- Tires work items only.
    customer_supplied_tires BOOLEAN NOT NULL DEFAULT FALSE,
    difficulty_minutes INTEGER NOT NULL DEFAULT 0
        CHECK (difficulty_minutes IN (0, 10, 20)),

    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (item_type = 'tires' OR (NOT customer_supplied_tires AND difficulty_minutes = 0)),
    CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX work_items_ticket_idx ON work_items (ticket_id, sort_order);

-- Every price and cost is a snapshot taken when the line is added.
CREATE TABLE line_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    work_item_id BIGINT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    line_kind TEXT NOT NULL
        CHECK (line_kind IN ('product', 'service', 'labor', 'part', 'custom')),
    -- Set for stocked products (tires, sensors); NULL for free-text lines.
    product_id BIGINT REFERENCES products(id) ON DELETE RESTRICT,
    -- Which pricing rule produced a service line, e.g. 'mount_balance',
    -- 'alignment', 'disposal', 'valve_stem', 'trailer_valve_stem', 'tpms_reset'.
    service_code TEXT,
    description TEXT NOT NULL CHECK (LENGTH(TRIM(description)) > 0),
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
    -- Internal only; never shown on customer-facing documents.
    unit_cost NUMERIC(10, 2) CHECK (unit_cost >= 0),
    taxable BOOLEAN NOT NULL,
    discount_type TEXT CHECK (discount_type IN ('amount', 'percent')),
    discount_value NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK ((line_kind = 'product') = (product_id IS NOT NULL)),
    CHECK (line_kind <> 'service' OR service_code IS NOT NULL),
    CHECK (discount_type IS NOT NULL OR discount_value = 0),
    CHECK (discount_type <> 'percent' OR discount_value <= 100)
);

CREATE INDEX line_items_work_item_idx ON line_items (work_item_id, sort_order);

-- Tires reserved for a ticket (the per-ticket breakdown of reserved_qty).
CREATE TABLE reservations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    line_item_id BIGINT NOT NULL UNIQUE REFERENCES line_items(id) ON DELETE RESTRICT,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Payments: deposits before invoicing, payments at invoicing, refunds.
-- ---------------------------------------------------------------------------
CREATE TABLE payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
    payment_kind TEXT NOT NULL
        CHECK (payment_kind IN ('deposit', 'payment', 'refund', 'return_fee')),
    method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'other')),
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX payments_ticket_idx ON payments (ticket_id);

-- ---------------------------------------------------------------------------
-- Pending orders: special-order tires and rims, mechanic parts, sensors,
-- and restock orders. A stocked-tire shortfall becomes two rows: the
-- customer's portion (ticket set) and the restock portion (ticket NULL).
-- ---------------------------------------------------------------------------
CREATE TABLE pending_orders (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id BIGINT REFERENCES tickets(id) ON DELETE RESTRICT,
    line_item_id BIGINT REFERENCES line_items(id) ON DELETE RESTRICT,
    product_id BIGINT REFERENCES products(id) ON DELETE RESTRICT,
    item_kind TEXT NOT NULL
        CHECK (item_kind IN ('tire', 'rim', 'tpms_sensor', 'part', 'other')),
    description TEXT NOT NULL,
    vendor TEXT,
    qty_ordered INTEGER NOT NULL CHECK (qty_ordered > 0),
    qty_arrived INTEGER NOT NULL DEFAULT 0 CHECK (qty_arrived >= 0),
    unit_cost NUMERIC(10, 2) CHECK (unit_cost >= 0),
    status TEXT NOT NULL DEFAULT 'needed'
        CHECK (
            status IN (
                'needed',
                'ordered',
                'arrived',
                'installed',
                'returned',
                'unclaimed',
                'cancelled'
            )
        ),
    returnable BOOLEAN NOT NULL DEFAULT TRUE,
    return_fee NUMERIC(10, 2) CHECK (return_fee >= 0),
    ordered_at TIMESTAMPTZ,
    expected_at DATE,
    arrived_at TIMESTAMPTZ,
    -- Set when the advisor reaches the customer (tires and rims only).
    customer_notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (qty_arrived <= qty_ordered),
    CHECK (status <> 'arrived' OR qty_arrived = qty_ordered),
    -- Rims can never be returned.
    CHECK (item_kind <> 'rim' OR NOT returnable),
    CHECK (item_kind NOT IN ('tire', 'tpms_sensor') OR product_id IS NOT NULL),
    -- Restock rows only make sense for stocked products.
    CHECK (ticket_id IS NOT NULL OR product_id IS NOT NULL)
);

CREATE INDEX pending_orders_open_idx ON pending_orders (status)
    WHERE status IN ('needed', 'ordered', 'arrived');
CREATE INDEX pending_orders_ticket_idx ON pending_orders (ticket_id);

CREATE TABLE call_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
    note TEXT,
    called_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX call_logs_ticket_idx ON call_logs (ticket_id, called_at);

-- ---------------------------------------------------------------------------
-- Shop floor: lifts and their queues.
-- ---------------------------------------------------------------------------
CREATE TABLE lifts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    queue TEXT NOT NULL CHECK (queue IN ('tires', 'mechanic', 'alignment')),
    sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO lifts (name, queue, sort_order) VALUES
    ('Tire Lift 1', 'tires', 1),
    ('Tire Lift 2', 'tires', 2),
    ('Mechanic Lift', 'mechanic', 3),
    ('Alignment Rack', 'alignment', 4);

-- One entry per work item. Position = enqueued_at (check-in time), id.
CREATE TABLE queue_entries (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    work_item_id BIGINT NOT NULL UNIQUE REFERENCES work_items(id) ON DELETE CASCADE,
    queue TEXT NOT NULL CHECK (queue IN ('tires', 'mechanic', 'alignment')),
    status TEXT NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'on_lift', 'done', 'removed', 'suspension_issue')),
    -- NULL = readiness computed automatically; TRUE/FALSE = advisor override.
    ready_override BOOLEAN,
    -- The lift it is on. May differ from its queue when the advisor moves it.
    lift_id BIGINT REFERENCES lifts(id) ON DELETE RESTRICT,
    enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,

    CHECK ((status = 'on_lift') = (lift_id IS NOT NULL)),
    CHECK (status <> 'suspension_issue' OR queue = 'alignment')
);

-- Only one car on a lift at a time.
CREATE UNIQUE INDEX queue_entries_one_per_lift_idx
    ON queue_entries (lift_id) WHERE status = 'on_lift';

CREATE INDEX queue_entries_active_idx
    ON queue_entries (queue, enqueued_at, id)
    WHERE status IN ('waiting', 'on_lift');

COMMIT;
