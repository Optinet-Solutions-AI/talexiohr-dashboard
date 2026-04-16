-- SECURITY INVOKER wrapper that runs LLM-generated SELECTs under
-- read-only + statement_timeout guards with an injected LIMIT 500.

CREATE OR REPLACE FUNCTION ask_ai_execute(q text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result jsonb;
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL default_transaction_read_only = on;

  EXECUTE format('SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (%s LIMIT 500) t', q)
    INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION ask_ai_execute(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ask_ai_execute(text) TO ask_ai_readonly;
