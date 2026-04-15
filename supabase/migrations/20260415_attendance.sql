-- Employees table (synced from Talexio)
CREATE TABLE IF NOT EXISTS employees (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  talexio_id    TEXT UNIQUE,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  full_name     TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Attendance records (one row per employee per day)
CREATE TABLE IF NOT EXISTS attendance_records (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id     UUID REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  date            DATE NOT NULL,

  -- Clock-in
  location_in     TEXT,           -- "Office", "WFH", "Not from the office", "No clocking", etc.
  lat_in          DOUBLE PRECISION,
  lng_in          DOUBLE PRECISION,
  time_in         TIME,

  -- Clock-out
  location_out    TEXT,
  lat_out         DOUBLE PRECISION,
  lng_out         DOUBLE PRECISION,
  time_out        TIME,

  -- Computed
  hours_worked    DOUBLE PRECISION,  -- decimal hours (e.g. 9.75)
  status          TEXT,              -- 'office' | 'wfh' | 'remote' | 'no_clocking' | 'vacation' | 'active' | 'broken' | 'unknown'
  comments        TEXT,
  raw_data        JSONB,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (employee_id, date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_date        ON attendance_records (date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_employee    ON attendance_records (employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status      ON attendance_records (status);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date    ON attendance_records (employee_id, date DESC);

-- Sync log (tracks each daily sync run)
CREATE TABLE IF NOT EXISTS sync_log (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sync_date   DATE NOT NULL,
  source      TEXT NOT NULL DEFAULT 'talexio',  -- 'talexio' | 'csv'
  records     INT  NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'success',  -- 'success' | 'error'
  error       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: disable for service role, enable for anon/auth later
ALTER TABLE employees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log          ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "service_role_employees"          ON employees          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_attendance_records" ON attendance_records FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_sync_log"           ON sync_log           FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow authenticated users to read
CREATE POLICY "auth_read_employees"          ON employees          FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_attendance_records" ON attendance_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_sync_log"           ON sync_log           FOR SELECT TO authenticated USING (true);
