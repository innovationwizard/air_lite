-- Lote 1 (C7/G2) — ETA calculada por bodega.
--
-- Pedido de Alexis (2026-08-12, verbatim): "a partir de esa factura en PDF
-- calculamos el ETA… para este proveedor en particular son cuatro días hábiles".
-- Hoy la ETA se teclea a mano desde el nombre de las carpetas que él manda
-- (`zacapa-eta-agosto-14`), y solo 3 de 11 facturas la tienen.
--
-- Decisiones (Jorge, 2026-08-14):
--   * El reloj arranca en la FECHA IMPRESA DE LA FACTURA (no en la fecha en que
--     recibimos el PDF) — por eso no hace falta columna nueva de recepción.
--   * Los días hábiles son CONFIGURABLES POR BODEGA (Zacapa y Petén están más
--     lejos que San José), en datos, no en código.
--   * Default inicial: 4 para todas.
--
-- CONVENCIÓN DE CONTEO (explícita para que nadie la adivine): `dias_habiles` son
-- días hábiles DESPUÉS de la fecha de factura, sin contar la fecha misma, y
-- saltando sábado y domingo. Feriados NO se consideran todavía (pregunta P3
-- abierta con Alexis).
--   ⚠️ MEDIDO 2026-08-14: las 3 ETAs que Alexis escribió a mano equivalen a +3
--   con esta convención (Zacapa 11-ago→14-ago; Petén y SJ 12-ago→17-ago), igual
--   que su ejemplo hablado (miércoles→lunes). Con el default 4 la ETA calculada
--   sale un día después que la suya. La ETA MANUAL siempre gana, así que esas 3
--   no se mueven; y la app muestra ambas cuando difieren, para que la diferencia
--   se resuelva con dato a la vista y no en silencio.
--
-- Historial append-only, última fila por destino manda (mismo patrón que
-- reyma_nc_config y los overrides). Aplicada con `supabase db push`. Idempotente.

CREATE TABLE IF NOT EXISTS reyma_eta_config (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  destino      VARCHAR(40) NOT NULL,   -- 'bodega-san-jose' | 'bodega-zacapa' | 'bodega-peten' | 'entrega-directa'
  dias_habiles SMALLINT NOT NULL CHECK (dias_habiles >= 0 AND dias_habiles <= 60),
  autor        VARCHAR(500) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reyma_eta_config_destino
  ON reyma_eta_config (destino, created_at DESC);

ALTER TABLE reyma_eta_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reyma_eta_config_service" ON reyma_eta_config;
CREATE POLICY "reyma_eta_config_service" ON reyma_eta_config
  FOR ALL USING (auth.role() = 'service_role');

-- Seed: 4 días hábiles para todos los destinos conocidos (default de Jorge).
INSERT INTO reyma_eta_config (destino, dias_habiles, autor)
SELECT d, 4, 'default inicial 2026-08-14 (Jorge): 4 días hábiles para todas las bodegas'
FROM unnest(ARRAY['bodega-san-jose', 'bodega-zacapa', 'bodega-peten', 'entrega-directa']) AS d
WHERE NOT EXISTS (SELECT 1 FROM reyma_eta_config);

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('inventario', '/api/inventarios/reyma/eta-config', '{POST}', 'Días hábiles de ETA por bodega (Alexis)'),
  ('gerencia',   '/api/inventarios/reyma/eta-config', '{POST}', 'Días hábiles de ETA por bodega'),
  ('admin',      '/api/inventarios/reyma/eta-config', '{POST}', 'Días hábiles de ETA por bodega')
ON CONFLICT (role, route_pattern) DO NOTHING;
