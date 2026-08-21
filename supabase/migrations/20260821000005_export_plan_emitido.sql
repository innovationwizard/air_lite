-- ARCHIVO EMITIDO — qué se le mandó al proveedor, cuándo y quién.
--
-- Cierra el hueco que quedó con `export_plan_draft` (20260821000004): el
-- borrador sobrevivía, pero «¿qué le mandamos a Carvajal en la semana 4?» no
-- tenía respuesta en el sistema. El archivo salía a la computadora de Wilmer y
-- ahí terminaba el rastro.
--
-- POR QUÉ IMPORTA MÁS QUE EL BORRADOR: el borrador es lo que estaba pensando;
-- ESTO es el compromiso que salió. Es contra esto que después se compara lo que
-- el proveedor efectivamente mandó — el fill rate que pide Wilmer (W6) — y es
-- lo que contesta la discusión concreta que él ya tiene con Carvajal: *"ellos
-- tienen demasiado de eso… me manda esto primero y lo que me urge no me lo
-- manda"*. Sin registro de lo pedido, esa conversación no tiene evidencia.
--
-- UNA FILA POR DESCARGA. Sin llave única a propósito: volver a descargar es
-- legítimo (corrigió algo, lo mandó de nuevo) y cada emisión es un hecho
-- distinto. La última por (proveedor, semana, mes) es la vigente.
--
-- QUÉ SE GUARDA Y POR QUÉ:
--   * `lineas` — la foto exacta de lo que fue al archivo, incluida la
--     `prioridad` (el orden ES el dato: define qué manda primero el proveedor).
--   * `sugerido` dentro de cada línea — lo que la app había PROPUESTO para esa
--     bodega en ese momento. Guardarlo al lado de lo que él realmente pidió es
--     la única forma de responder después «¿qué tan lejos estábamos?», y hoy hay
--     una pregunta abierta justo sobre eso (de dónde debe salir la cantidad
--     semanal: hoy proponemos Sugerido ÷ 4, que es un supuesto nuestro).
--     Reconstruirlo después es imposible: el Sugerido cambia con cada sync.
--   * `sha256` — huella de los bytes descargados. Permite decir «este es el
--     archivo que salió», no una reconstrucción parecida. NULL si el navegador
--     no expone WebCrypto (contexto no seguro); se prefiere NULL honesto a un
--     hash inventado.
--
-- INMUTABLE DE VERDAD, no por convención: un trigger BLOQUEA UPDATE. Un
-- registro de auditoría que se puede editar en silencio no es un registro de
-- auditoría. DELETE queda permitido para retención/limpieza operativa — borrar
-- deja un hueco visible; editar falsifica.
--
-- ⚠️ INERTE, igual que el borrador (Jorge, 2026-08-21): nada lo lee para
-- calcular. Conectarlo a tránsito o a fill-rate se decide aparte.
--
-- Aplicada con `supabase db push`. Idempotente.

CREATE TABLE IF NOT EXISTS export_plan_emitido (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  proveedor      VARCHAR(120) NOT NULL,
  semana         SMALLINT     NOT NULL CHECK (semana BETWEEN 1 AND 5),
  mes            DATE         NOT NULL,
  archivo        VARCHAR(300) NOT NULL,   -- nombre con el que se descargó
  -- [{product_id, cod, desc, prioridad, cantidades:{bodega:n|null}, sugerido:{bodega:n|null}}]
  lineas         JSONB        NOT NULL,
  total_lineas   INTEGER      NOT NULL CHECK (total_lineas >= 0),
  total_unidades NUMERIC(18,4) NOT NULL,
  sha256         CHAR(64),
  autor          VARCHAR(500) NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT export_plan_emitido_lineas_array CHECK (jsonb_typeof(lineas) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_export_plan_emitido_lookup
  ON export_plan_emitido (proveedor, mes DESC, semana DESC, created_at DESC);

ALTER TABLE export_plan_emitido ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "export_plan_emitido_service" ON export_plan_emitido;
CREATE POLICY "export_plan_emitido_service" ON export_plan_emitido
  FOR ALL USING (auth.role() = 'service_role');

-- Inmutabilidad en la base, no en la buena voluntad de quien escriba el código.
CREATE OR REPLACE FUNCTION export_plan_emitido_no_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'export_plan_emitido es un registro inmutable: no se puede modificar una emisión ya hecha (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS export_plan_emitido_inmutable ON export_plan_emitido;
CREATE TRIGGER export_plan_emitido_inmutable
  BEFORE UPDATE ON export_plan_emitido
  FOR EACH ROW EXECUTE FUNCTION export_plan_emitido_no_update();

COMMENT ON TABLE export_plan_emitido IS
  'Registro inmutable de cada archivo de plan de compra descargado para un '
  'proveedor (W1(a)). Una fila por descarga; UPDATE bloqueado por trigger. '
  'Guarda lo pedido Y el Sugerido que la app proponía en ese momento. INERTE: '
  'ninguna ruta ni sync lo lee para calcular.';

INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT v.role, '/api/compras/reabastecimiento/export/emitido', ARRAY['GET', 'POST'],
       'Registrar y consultar los archivos de plan de compra ya emitidos'
FROM (VALUES ('admin'), ('compras'), ('gerencia')) AS v(role)
WHERE NOT EXISTS (
  SELECT 1 FROM route_permissions rp
   WHERE rp.role = v.role
     AND rp.route_pattern = '/api/compras/reabastecimiento/export/emitido'
);
