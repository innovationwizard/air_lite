-- Add user_profiles row for operaciones@airefill.app (Mario).
-- This user sees: Operaciones (Días de Inventario, Hot List, Hold List) + OA + Demostración de Valor.
INSERT INTO user_profiles (id, display_name, role)
VALUES (
  '51762281-0b93-4b09-88e8-dae95f8022b3',
  'Operaciones',
  'operaciones'
)
ON CONFLICT (id) DO UPDATE SET role = 'operaciones';
