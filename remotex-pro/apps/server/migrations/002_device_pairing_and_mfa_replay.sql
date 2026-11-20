-- Apply after 001_initial.sql. Safe to re-run.
ALTER TABLE devices ALTER COLUMN credential_hash DROP NOT NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS paired_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_refresh_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_totp_step BIGINT NOT NULL DEFAULT -1;
CREATE INDEX IF NOT EXISTS devices_paired_idx ON devices(paired_at) WHERE revoked_at IS NULL;
