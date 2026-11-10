-- Logins for the service advisors, and who did what.
BEGIN;

CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username TEXT NOT NULL CHECK (LENGTH(TRIM(username)) >= 2),
    display_name TEXT NOT NULL CHECK (LENGTH(TRIM(display_name)) > 0),
    -- scrypt$<salt>$<hash>, never the password itself.
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'advisor' CHECK (role IN ('admin', 'advisor')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX users_username_idx ON users (LOWER(username));

-- A signed-in browser. The id is a SHA-256 of the cookie token, so a leaked
-- database can't be used to sign in.
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Who did it. Inside a transaction the API sets app.user_id, so these fill
-- themselves in; NULL means before logins existed (or a script).
CREATE FUNCTION current_app_user() RETURNS BIGINT
LANGUAGE SQL STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', TRUE), '')::BIGINT $$;

ALTER TABLE tickets
    ADD COLUMN created_by BIGINT REFERENCES users(id) DEFAULT current_app_user(),
    ADD COLUMN accepted_by BIGINT REFERENCES users(id),
    ADD COLUMN invoiced_by BIGINT REFERENCES users(id);
ALTER TABLE payments ADD COLUMN recorded_by BIGINT REFERENCES users(id) DEFAULT current_app_user();
ALTER TABLE call_logs ADD COLUMN logged_by BIGINT REFERENCES users(id) DEFAULT current_app_user();
ALTER TABLE inventory_movements ADD COLUMN created_by BIGINT REFERENCES users(id) DEFAULT current_app_user();

COMMIT;
