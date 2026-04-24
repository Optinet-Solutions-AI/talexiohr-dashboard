-- Detected timezone at each clocking (from GPS lat/lng).
-- Populated by the pull endpoint using tz-lookup. Used to show where the
-- employee physically was when they clocked in.
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS detected_timezone TEXT;
