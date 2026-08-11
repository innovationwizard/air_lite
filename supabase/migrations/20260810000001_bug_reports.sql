-- Bug-report widget (delivery phase, 2026-08-10).
--
-- Persist-first design: every report is inserted here BEFORE the Resend email
-- is attempted, so a provider failure can never silently lose a report
-- (docs/feedback/BUG_REPORT_DESIGN.md). The email is the notification channel;
-- this table is the record.
--
-- route_permissions: POST /api/feedback for every role (superuser bypasses,
-- no entry needed) — all users must be able to report bugs.
-- Applied via `supabase db push`. Idempotent.

CREATE TABLE IF NOT EXISTS bug_reports (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- reporter (resolved server-side from the session, never client-supplied)
  user_id UUID NOT NULL,
  autor VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,

  -- report body
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('dato_incorrecto', 'falta_algo')),
  donde TEXT,               -- "¿Dónde? Fila y columna:"
  app_dice TEXT,            -- "La app dice:"
  app_deberia_decir TEXT,   -- "La app debería decir:"
  que_falta TEXT,           -- "¿Qué es lo que hace falta?"
  CONSTRAINT bug_reports_kind_fields CHECK (
    (kind = 'dato_incorrecto' AND donde IS NOT NULL AND app_dice IS NOT NULL
      AND app_deberia_decir IS NOT NULL AND que_falta IS NULL)
    OR
    (kind = 'falta_algo' AND que_falta IS NOT NULL AND donde IS NULL
      AND app_dice IS NULL AND app_deberia_decir IS NULL)
  ),

  -- auto-captured context
  url TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  screenshot_b64 TEXT,      -- base64 JPEG (no data: prefix); NULL when capture failed

  -- email delivery outcome (updated after the Resend call)
  email_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'sent', 'failed', 'not_configured')),
  resend_id TEXT,
  email_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_created_at ON bug_reports (created_at DESC);

-- Writes go through the service client only; superuser/admin can read in-app.
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bug_reports_read" ON bug_reports;
CREATE POLICY "bug_reports_read" ON bug_reports FOR SELECT USING (
  auth_role() IN ('superuser', 'admin')
);
DROP POLICY IF EXISTS "bug_reports_service_write" ON bug_reports;
CREATE POLICY "bug_reports_service_write" ON bug_reports FOR ALL USING (
  auth.role() = 'service_role'
);

INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT r, '/api/feedback', '{POST}', 'Reporte de bugs — todos los roles'
FROM unnest(ARRAY[
  'admin', 'gerencia', 'compras', 'ventas', 'inventario',
  'financiero', 'testuser', 'operaciones'
]) AS r
ON CONFLICT (role, route_pattern) DO NOTHING;
