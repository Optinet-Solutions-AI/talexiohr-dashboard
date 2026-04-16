-- Parameterized aggregator for the query_attendance tool.
-- Keeps aggregation server-side so we never ship raw rows to the LLM.

CREATE OR REPLACE FUNCTION query_attendance(
  p_from         date,
  p_to           date,
  p_group_by     text,                       -- 'employee' | 'group_type' | 'unit' | 'date'
  p_group_type   text DEFAULT NULL,
  p_unit         text DEFAULT NULL,
  p_employee_ids uuid[] DEFAULT NULL,
  p_limit        int DEFAULT 50
)
RETURNS TABLE (
  group_key           text,
  office_days         int,
  wfh_days            int,
  remote_days         int,
  leave_days          int,
  sick_days           int,
  no_clocking_days    int,
  days_worked         int,
  total_hours         numeric,
  avg_hours_per_day   numeric
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_group_by NOT IN ('employee','group_type','unit','date') THEN
    RAISE EXCEPTION 'invalid group_by: %', p_group_by;
  END IF;

  RETURN QUERY EXECUTE format($q$
    SELECT
      %s AS group_key,
      count(*) FILTER (WHERE a.status = 'office')::int       AS office_days,
      count(*) FILTER (WHERE a.status = 'wfh')::int          AS wfh_days,
      count(*) FILTER (WHERE a.status = 'remote')::int       AS remote_days,
      count(*) FILTER (WHERE a.status = 'vacation')::int     AS leave_days,
      count(*) FILTER (WHERE a.status = 'sick')::int         AS sick_days,
      count(*) FILTER (WHERE a.status = 'no_clocking')::int  AS no_clocking_days,
      count(*) FILTER (WHERE a.status IN ('office','wfh','remote'))::int AS days_worked,
      COALESCE(sum(a.hours_worked), 0)::numeric                                     AS total_hours,
      CASE WHEN count(*) FILTER (WHERE a.hours_worked IS NOT NULL) > 0
           THEN ROUND((sum(a.hours_worked) / count(*) FILTER (WHERE a.hours_worked IS NOT NULL))::numeric, 2)
           ELSE 0 END                                                                AS avg_hours_per_day
    FROM attendance_records a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.date BETWEEN $1 AND $2
      AND e.excluded = false
      AND ($3::text IS NULL OR e.group_type = $3)
      AND ($4::text IS NULL OR e.unit = $4)
      AND ($5::uuid[] IS NULL OR a.employee_id = ANY($5))
    GROUP BY %s
    ORDER BY %s
    LIMIT $6
  $q$,
    CASE p_group_by
      WHEN 'employee'   THEN 'e.full_name'
      WHEN 'group_type' THEN 'COALESCE(e.group_type, ''unclassified'')'
      WHEN 'unit'       THEN 'COALESCE(e.unit, ''(none)'')'
      WHEN 'date'       THEN 'to_char(a.date, ''YYYY-MM-DD'')'
    END,
    CASE p_group_by
      WHEN 'employee'   THEN 'e.full_name'
      WHEN 'group_type' THEN 'COALESCE(e.group_type, ''unclassified'')'
      WHEN 'unit'       THEN 'COALESCE(e.unit, ''(none)'')'
      WHEN 'date'       THEN 'to_char(a.date, ''YYYY-MM-DD'')'
    END,
    CASE p_group_by
      WHEN 'date' THEN '1 DESC'
      ELSE '1 ASC'
    END
  )
  USING p_from, p_to, p_group_type, p_unit, p_employee_ids, p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION query_attendance(date, date, text, text, text, uuid[], int) TO service_role;
