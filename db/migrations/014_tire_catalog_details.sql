-- Tire catalog details from supplier files (see npm run import-tires).
--
-- Type and season become two standard columns: the type is what the tire is
-- built for (touring, performance, highway, all-terrain, rugged-terrain,
-- mud-terrain), the season is when it can be driven (all-season,
-- all-weather, summer, winter). Before this, season held both.

ALTER TABLE tire_lines
    ADD COLUMN tire_type TEXT CHECK (tire_type IN (
        'touring', 'performance', 'highway', 'all_terrain', 'rugged_terrain', 'mud_terrain'
    )),
    -- Road hazard protection included with the tire.
    ADD COLUMN road_hazard BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE tire_lines SET tire_type = season, season = 'all_season'
WHERE season IN ('highway', 'all_terrain');
UPDATE tire_lines SET tire_type = 'mud_terrain', season = NULL
WHERE season = 'mud_terrain';

ALTER TABLE tire_lines DROP CONSTRAINT tire_lines_season_check;
ALTER TABLE tire_lines ADD CONSTRAINT tire_lines_season_check
    CHECK (season IN ('all_season', 'all_weather', 'summer', 'winter'));

-- Per size. Warranty can differ by size within a line (some brands set it by
-- speed rating); when blank the line's warranty applies. 0 = no mileage
-- warranty.
ALTER TABLE products
    ADD COLUMN warranty_miles INTEGER CHECK (warranty_miles >= 0 AND warranty_miles <= 200000),
    ADD COLUMN tread_depth_32nds SMALLINT CHECK (tread_depth_32nds BETWEEN 1 AND 40),
    ADD COLUMN utqg_treadwear SMALLINT CHECK (utqg_treadwear BETWEEN 20 AND 1500),
    ADD COLUMN utqg_traction TEXT CHECK (utqg_traction IN ('AA', 'A', 'B', 'C')),
    ADD COLUMN utqg_temperature TEXT CHECK (utqg_temperature IN ('A', 'B', 'C')),
    -- Maximum load per tire, in pounds, at this pressure (psi) when given.
    ADD COLUMN max_load_lbs INTEGER CHECK (max_load_lbs BETWEEN 100 AND 20000),
    ADD COLUMN max_load_psi SMALLINT CHECK (max_load_psi BETWEEN 10 AND 150),
    -- Sidewall style code as the supplier writes it: BW, BLK, ROBL, VSB...
    ADD COLUMN sidewall TEXT CHECK (LENGTH(sidewall) <= 20),
    -- The same tire's other size name, e.g. 33X12.50R20LT for LT285/55R20.
    ADD COLUMN size_alt TEXT CHECK (LENGTH(size_alt) <= 40);
