-- What a vehicle needs from its tires. Everything is optional: blank means
-- unknown, and nothing is filled in automatically (the Decode VIN button only
-- suggests values for the advisor to accept).
BEGIN;

ALTER TABLE vehicles
    ADD COLUMN trim TEXT,
    -- Unknown is treated like AWD: alternate sizes only when replacing all 4.
    ADD COLUMN drive_type TEXT NOT NULL DEFAULT 'unknown'
        CHECK (drive_type IN ('2wd', 'awd', '4wd', 'unknown')),
    -- Staggered setups (different front and rear sizes); tire_size is the front.
    ADD COLUMN rear_tire_size TEXT,

    -- Special-tire flags: the only vehicles where load and speed are checked.
    ADD COLUMN is_ev BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN heavy_duty BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN run_flat BOOLEAN NOT NULL DEFAULT FALSE,

    -- From the door placard or the old tire, when it matters.
    ADD COLUMN required_load_index INTEGER
        CHECK (required_load_index BETWEEN 60 AND 160),
    ADD COLUMN required_load_range TEXT
        CHECK (required_load_range IN ('B', 'C', 'D', 'E', 'F', 'G', 'H')),
    ADD COLUMN required_speed_rating TEXT
        CHECK (required_speed_rating IN ('L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'H', 'V', 'W', 'Y', 'Z'));

COMMIT;
