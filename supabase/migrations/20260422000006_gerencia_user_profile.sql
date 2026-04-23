-- ============================================================================
-- Gerencia demo user profile
-- ============================================================================
-- Creates the user_profiles row for the auth user gerencia@airefill.app,
-- which was provisioned via the Supabase admin API on 2026-04-22 evening so
-- that David (and later Luis) can log into /gerencia/validacion without
-- Jorge's superuser credentials.
--
-- Auth credentials (stored in auth.users, not in this table):
--   email:    gerencia@airefill.app
--   password: set via admin API at creation time
-- ============================================================================

INSERT INTO user_profiles (id, display_name, role)
VALUES (
  'caafe3a0-efda-4c30-99d5-6ad2febfc684',
  'Gerencia (Demo)',
  'gerencia'
)
ON CONFLICT (id) DO UPDATE SET role = 'gerencia';
