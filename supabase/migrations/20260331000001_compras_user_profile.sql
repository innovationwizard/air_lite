-- Add user_profiles row for compras@airefill.app
-- This user sees: Demostración de Valor + all OA views (no Riesgos, no POC, no Admin)
INSERT INTO user_profiles (id, display_name, role)
VALUES (
  '6d80c7e2-cda1-4f19-a2e8-01809d7c5b83',
  'Compras',
  'compras'
)
ON CONFLICT (id) DO UPDATE SET role = 'compras';
