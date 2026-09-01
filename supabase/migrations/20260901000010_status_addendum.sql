-- ADDENDUM — hechos descubiertos DESPUES del cierre del corpus (26-ago).
--
-- El corpus de transcripciones se prohibió a sí mismo agregar filas, y con
-- razón: es un registro fechado de lo que se dijo, y editarlo lo volvería un
-- documento sin autoridad. Pero eso lo deja congelado en el 26 de agosto, y el
-- 01-sep el proyecto encontró TRES veces que el corpus iba detrás de la
-- realidad: dos funciones marcadas como pendientes ya estaban construidas, y un
-- modelo entero de Alexis no tenía fila. Una brecha descubierta después no
-- tenía dónde vivir, así que no aparecía en ningún porcentaje — invisible por
-- construcción, no por descuido.
--
-- `es_addendum` marca esas filas para que la página las muestre como lo que
-- son: hallazgos posteriores al cierre, con su propia fuente y su fecha. Entran
-- al denominador igual que las demás — una brecha encontrada tarde sigue siendo
-- una brecha — pero el lector puede ver que no estaban en el documento original.
--
-- Aplicada con `supabase db push`. Idempotente.

ALTER TABLE status_items
  ADD COLUMN IF NOT EXISTS es_addendum BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN status_items.es_addendum IS
  'true = fila descubierta despues del cierre del corpus (26-ago); vive en '
  'items_addendum.tsv, no en items.tsv, que es inmutable.';

CREATE INDEX IF NOT EXISTS idx_status_items_addendum
  ON status_items (es_addendum) WHERE es_addendum;
