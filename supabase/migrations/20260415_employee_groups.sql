-- Add group classification and metadata to employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS group_type   TEXT DEFAULT 'unclassified'
    CHECK (group_type IN ('office_malta', 'remote', 'unclassified')),
  ADD COLUMN IF NOT EXISTS unit         TEXT,
  ADD COLUMN IF NOT EXISTS job_schedule TEXT,
  ADD COLUMN IF NOT EXISTS position     TEXT;
