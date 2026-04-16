-- Dedicated Postgres role for the Ask AI SQL escape hatch.
-- Grants SELECT on only the two tables the agent is allowed to query.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ask_ai_readonly') THEN
    CREATE ROLE ask_ai_readonly LOGIN PASSWORD 'CHANGE_ME_IN_SUPABASE_DASHBOARD';
  END IF;
END$$;

-- Strip everything, then grant only what is needed.
REVOKE ALL ON SCHEMA public FROM ask_ai_readonly;
GRANT USAGE ON SCHEMA public TO ask_ai_readonly;

GRANT SELECT ON employees          TO ask_ai_readonly;
GRANT SELECT ON attendance_records TO ask_ai_readonly;

-- Bypass RLS so the role can read without needing policies.
-- (Policies still apply to service_role and authenticated, not to this role.)
ALTER TABLE employees          FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;

CREATE POLICY "ask_ai_readonly_employees"
  ON employees FOR SELECT TO ask_ai_readonly
  USING (true);

CREATE POLICY "ask_ai_readonly_attendance_records"
  ON attendance_records FOR SELECT TO ask_ai_readonly
  USING (true);
