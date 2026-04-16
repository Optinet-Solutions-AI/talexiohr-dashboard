-- Add excluded flag to employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS excluded BOOLEAN DEFAULT false;
