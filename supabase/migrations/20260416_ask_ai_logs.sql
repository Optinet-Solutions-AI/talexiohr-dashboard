-- Log table for Ask AI agent requests.
-- One row per inbound /api/ask request, written in a finally block.

CREATE TABLE IF NOT EXISTS ask_ai_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  user_id           uuid REFERENCES auth.users(id),
  question          text NOT NULL,
  relevance_passed  boolean,
  rate_limited      boolean NOT NULL DEFAULT false,
  tool_calls        jsonb,
  final_answer      text,
  total_tokens      int,
  total_duration_ms int,
  error             text
);

CREATE INDEX IF NOT EXISTS ask_ai_logs_user_created
  ON ask_ai_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ask_ai_logs_created
  ON ask_ai_logs (created_at DESC);

ALTER TABLE ask_ai_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_ask_ai_logs"
  ON ask_ai_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_own_ask_ai_logs"
  ON ask_ai_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid());
