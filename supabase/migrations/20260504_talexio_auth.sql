-- Talexio auth token store. Single-row table — the live JWT used by cron and
-- the Import "Pull from Talexio" button. Lets the UI rotate the token without
-- a Vercel redeploy.
CREATE TABLE IF NOT EXISTS talexio_auth (
  id          INT PRIMARY KEY DEFAULT 1,
  token       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ,            -- decoded from JWT 'exp' claim, nullable
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT,                   -- email of user who pasted the token
  CONSTRAINT  talexio_auth_singleton CHECK (id = 1)
);

ALTER TABLE talexio_auth ENABLE ROW LEVEL SECURITY;

-- Service role only. Tokens are sensitive — authenticated users go through
-- the API routes (which run as service role) rather than reading directly.
CREATE POLICY "service_role_talexio_auth" ON talexio_auth
  FOR ALL TO service_role USING (true) WITH CHECK (true);
