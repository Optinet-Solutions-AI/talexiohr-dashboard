-- Per-employee timezone (matches the timezone Talexio displays for that employee)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Europe/Malta';

-- Backfill any NULLs to the default
UPDATE employees SET timezone = 'Europe/Malta' WHERE timezone IS NULL;
