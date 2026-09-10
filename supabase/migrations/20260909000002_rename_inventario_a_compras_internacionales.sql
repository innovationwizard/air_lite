-- Rename role `inventario` → `compras_internacionales`, and every
-- `/api/inventarios/*` route_permissions pattern → `/api/compras-internacionales/*`.
--
-- POR QUÉ: Alexis's real department, per his own account
-- (comprasinternacionales@airefill.app), is Compras Internacionales. The app
-- named his RBAC role `inventario` and his whole page/API namespace
-- `/inventarios/*` instead — a mismatch present since his account was created
-- (2026-08-11). Not a one-off: `frontend/src/lib/status/metricas.ts` already
-- has a correctly-named, unrelated `Area` entry (`compras_intl: 'Compras
-- internacionales'`) — the right vocabulary already existed elsewhere in this
-- codebase and just never made it into his role/URL.
--
-- SCOPE, measured against production before writing this (read-only queries,
-- 2026-09-09):
--   * `user_profiles`: exactly 1 row has role='inventario' — Alexis
--     (id c4b960c3-0b79-489a-8abf-ed885f321802). No one else.
--   * `route_permissions`: 26 rows with role='inventario'. Of those, 15 have
--     route_pattern starting '/api/inventarios/...' (rewritten below too);
--     11 point elsewhere (/api/backtest/*, /api/feedback, /api/kpis/*,
--     /api/oa/*, /api/status) and only need the role column changed.
--   * No collision: `compras` (Wilmer) is a DIFFERENT, untouched role.
--
-- ORDER MATTERS — apply this ONLY AFTER the matching code deploy is live.
-- The currently-deployed code (before that deploy) only recognizes
-- role='inventario' in its Role[] allow-lists; running this migration first
-- would lock Alexis out until the code catches up. Downtime is accepted here
-- (off-hours, no active session) — but the deploy-then-migrate order keeps
-- that gap as short as possible and, if the DEPLOY itself fails, the database
-- is never touched. See the code-side change (roles.ts, Sidebar.tsx, the
-- `/inventarios` → `/compras-internacionales` directory rename) shipped in
-- the same commit as this file.
--
-- Applied by hand in the Supabase SQL editor (never `supabase db push` blind
-- — this repo's migration history drifts from what is actually applied; see
-- the migrations-applied-by-hand note). Idempotent: safe to re-run.
--
-- FIXED 2026-09-09 (first attempt failed): `user_profiles.role`,
-- `route_permissions.role`, AND `bug_reports.role` are all `VARCHAR(20)`
-- (20260322000001, 20260323000002, 20260810000001) — `'compras_internacionales'`
-- is 23 characters, so the first run of this file errored on step (b) with
-- `22001: value too long for type character varying(20)`. Confirmed
-- read-only afterward: the whole script rolled back atomically (Supabase SQL
-- editor runs a pasted script as one transaction) — Alexis's row and all 26
-- `route_permissions` rows were still `role='inventario'`, nothing partial.
-- `bug_reports.role` wasn't even touched by this migration, but Alexis's next
-- bug report would have hit the identical wall the moment his session role
-- became `compras_internacionales` — widened here too, pre-emptively, not
-- reactively. Sized to VARCHAR(40), matching this codebase's existing
-- convention for role/slug columns (`reyma_products.modelo VARCHAR(40)`,
-- 20260901000011) — headroom for whatever comes after this one.
--
-- ROLLBACK (if ever needed, mirror image of steps b/c/d — the column widenings
-- are NOT rolled back: widening is one-directional by design, and a narrower
-- column serves no purpose once nothing needs the extra room):
--   UPDATE user_profiles SET role = 'inventario' WHERE role = 'compras_internacionales';
--   UPDATE route_permissions
--      SET role = 'inventario',
--          route_pattern = replace(route_pattern, '/api/compras-internacionales', '/api/inventarios')
--    WHERE role = 'compras_internacionales';
--   ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
--   ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
--     CHECK (role IN ('superuser','admin','gerencia','compras','ventas','inventario',
--                      'financiero','testuser','operaciones','project_manager',
--                      'ceo','sales_manager'));

-- 0) Widen the three VARCHAR(20) role columns FIRST — everything below writes
--    or allow-lists a 23-character value, so this has to land before any of
--    it. Widening a VARCHAR is always safe: it can't truncate or reject any
--    value that already fits, so this alone changes nothing observable.
ALTER TABLE user_profiles ALTER COLUMN role TYPE VARCHAR(40);
ALTER TABLE route_permissions ALTER COLUMN role TYPE VARCHAR(40);
ALTER TABLE bug_reports ALTER COLUMN role TYPE VARCHAR(40);

-- a) Purely additive — safe to run anytime, changes nothing observable.
--    Widens the allow-list to include the new role WITHOUT removing the old
--    one yet, so this step alone can never break an in-flight session.
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('superuser', 'admin', 'gerencia', 'compras', 'ventas', 'inventario',
                   'compras_internacionales', 'financiero', 'testuser', 'operaciones',
                   'project_manager', 'ceo', 'sales_manager'));

-- b) Alexis's one row.
UPDATE user_profiles SET role = 'compras_internacionales' WHERE role = 'inventario';

-- c) The 26 route_permissions rows — role always changes; route_pattern only
--    for the 15 that start with /api/inventarios.
UPDATE route_permissions
   SET role = 'compras_internacionales',
       route_pattern = replace(route_pattern, '/api/inventarios', '/api/compras-internacionales')
 WHERE role = 'inventario';

-- d) Cleanup — drop 'inventario' from the allow-list now that nothing uses it.
--    Run this LAST, after confirming (b) and (c) landed (see verification
--    queries below) — reordering this before (b)/(c) would make the update in
--    (b) fail the CHECK constraint on the way OUT of 'inventario'... no, the
--    constraint only restricts what values CAN be written, not what's being
--    replaced, so ordering (a,b,c,d) is safe either way; (d) is placed last
--    here purely so a reader can visually confirm b/c happened before the
--    door closes on the old value.
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('superuser', 'admin', 'gerencia', 'compras', 'ventas',
                   'compras_internacionales', 'financiero', 'testuser', 'operaciones',
                   'project_manager', 'ceo', 'sales_manager'));

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION — run after (c), before or after (d), and paste the results
-- back for the record:
--
--   select count(*) from user_profiles where role = 'inventario';
--     → expect 0
--   select count(*) from route_permissions where role = 'inventario';
--     → expect 0
--   select route_pattern from route_permissions
--    where role = 'compras_internacionales' and route_pattern like '/api/compras-internacionales%'
--    order by route_pattern;
--     → expect 17 rows (corrected 2026-09-09 after applying: the plan's "15"
--       undercounted the three clave-pendiente/* sub-routes added this
--       session; verified against production — 17 + 9 elsewhere = 26 total)
--
-- APPLIED 2026-09-09 — verified: Alexis role=compras_internacionales, 0 rows
-- left at role='inventario' in either table, 26/26 route_permissions rows
-- migrated (17 under /api/compras-internacionales/*, 9 unchanged elsewhere).
