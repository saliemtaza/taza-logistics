-- Distinguishes "never attempted" from "tried and failed" so a
-- permanently-bad address stops being pulled into the auto-retry batch
-- loop forever. NULL = never attempted (or a successful geocode cleared
-- it); set = last attempt failed, needs a manual Retry.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS geocode_failed_at TIMESTAMPTZ;
