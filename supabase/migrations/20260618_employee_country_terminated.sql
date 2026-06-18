-- Add country + termination + sync-timestamp to employees.
-- country: the employee's active-position country name from Talexio (e.g. "Malta").
-- is_terminated: synced from Talexio employee.isTerminated.
-- details_synced_at: last time the employee-detail sync ran, for visibility.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS country           TEXT,
  ADD COLUMN IF NOT EXISTS is_terminated     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS details_synced_at TIMESTAMPTZ;
