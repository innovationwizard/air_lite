-- MODELO DE PUNTO DE REORDEN + LEAD TIME + ALCANCE MÁXIMO — A4.27 / A4.13 / A4.12.
--
-- QUÉ ES, en palabras de quien lo mandó (20-ago, grupo de abastecimiento):
--   *«Les comparto el otro modelo que nos serviría para Darnel y los proveedores
--   de Asia y hasta los locales ya que trabaja bajo el modelo de punto de
--   reorden + lead time y alcance máximo para generar el pedido. Siempre la
--   columna vertebral es la venta, generemos sobre el promedio de 2 meses y que
--   quede editable de tal forma que pueda cambiarse.»*
--
-- POR QUÉ ES UN MOTOR NUEVO Y NO UNA VARIANTE DEL DE REYMA. Reyma trabaja con
-- orden global mensual + MRP semanal + armado de furgones. Esto es otra cosa:
-- niveles de inventario (seguridad, reorden, máximo) y un pedido que sale de la
-- diferencia contra el máximo. Meterlos en el mismo código para «no duplicar»
-- pondría en riesgo la paridad de 2,752 celdas que el modelo Reyma ya tiene
-- medida, a cambio de nada — no son el mismo cálculo.
--
-- LO QUE SÍ SE REUTILIZA es la infraestructura que ya existe para tener varios
-- modelos: `modelo_proveedor` guarda los parámetros y `reyma_products.modelo`
-- discrimina el alcance. Un motor nuevo, la misma manera de configurarlo.
--
-- ⚠️ LAS UNIDADES IMPORTAN Y EL LIBRO MEZCLA DOS.
-- El inventario se captura en FARDOS y todo el cálculo corre en MILLARES (ML).
-- La conversión es `fardos × Und/Fardo / 1000`. Un producto sin `Und/Fardo` no
-- se puede convertir, y por eso la carga lo RETIENE en vez de asumir 1: un
-- millar mal calculado se propaga a la cobertura, al estado y al pedido.
--
-- Aplicada con `supabase db push`. Idempotente.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · PARÁMETROS — se extiende `modelo_proveedor`, no se crea otra tabla
-- ─────────────────────────────────────────────────────────────────────────────
-- Los modelos de Reyma/Carvajal y los de reorden comparten el concepto de
-- «proveedor con sus números» y comparten la navegación. Separarlos en dos
-- tablas obligaría a la página a preguntar en dos lados quién existe.

ALTER TABLE modelo_proveedor
  ADD COLUMN IF NOT EXISTS motor VARCHAR(20) NOT NULL DEFAULT 'reyma'
    CHECK (motor IN ('reyma', 'reorden')),
  -- Semanas de cobertura. El libro las declara en `PARAMETROS`.
  ADD COLUMN IF NOT EXISTS semanas_lead_time  NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS semanas_reorden    NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS semanas_inv_maximo NUMERIC(6,2),
  -- Meses del promedio móvil que alimenta la proyección. El mensaje pide DOS;
  -- el libro traía tres («prom Jul-Sep»). Se guarda como dato y editable,
  -- porque el pedido explícito fue «que quede editable… para que el modelo
  -- responda diferente».
  ADD COLUMN IF NOT EXISTS meses_promedio     INT,
  -- Capacidad del contenedor marítimo: 70 m³, distinto del furgón de 100.
  ADD COLUMN IF NOT EXISTS capacidad_contenedor_m3 NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS moneda VARCHAR(8);

COMMENT ON COLUMN modelo_proveedor.motor IS
  'Que calculo usa el modelo: `reyma` (orden global + MRP semanal + furgones) o '
  '`reorden` (punto de reorden + lead time + alcance maximo). Son dos motores '
  'distintos, no dos configuraciones del mismo.';

-- ── DARNEL — parámetros leídos del libro, sin inventar ninguno ──────────────
-- Stock de seguridad 3 sem · lead time 7 sem · punto de reorden 9 sem ·
-- inventario máximo 10 sem + semanas/contenedor · contenedor 70 m³ · USD.
--
-- ⚠️ 3 + 7 = 10, pero el libro pone el reorden en 9 y el máximo en 10. Se
-- siembra TAL COMO ESTÁ. Corregirlo a 10 sería mejorar el modelo de alguien sin
-- preguntarle, y el número cambia qué productos entran a «REORDENAR».
INSERT INTO modelo_proveedor (
  slug, nombre, orden, activo, provisional, motor,
  semanas_seguridad, semanas_lead_time, semanas_reorden, semanas_inv_maximo,
  meses_promedio, capacidad_contenedor_m3, moneda, notas
) VALUES (
  'darnel', 'Darnel', 30, true, false, 'reorden',
  3, 7, 9, 10,
  2, 70, 'USD',
  'Parametros leidos del libro del 20-ago. El libro declara «Punto de Reorden = SS + LT» '
  'pero pone 9 donde la suma da 10; se siembra 9 tal como esta y la pantalla marca la '
  'inconsistencia. Promedio de 2 meses por instruccion escrita del 20-ago, aunque el libro '
  'traia «prom Jul-Sep»; es editable a proposito. Incoterm FOB Cartagena / Pto. Sto. Tomas.'
) ON CONFLICT (slug) DO NOTHING;

-- ── ASIA / CONTENEDOR — mismo motor, alcance vacío ─────────────────────────
-- Nace sin códigos y sin parámetros propios. Es deliberado: el libro sólo trae
-- Darnel, y nadie ha dicho qué productos ni qué lead time son los de Asia.
-- Un modelo vacío y rotulado como tal es honesto; uno poblado con los números
-- de Darnel sería una pantalla que se ve terminada y miente.
INSERT INTO modelo_proveedor (
  slug, nombre, orden, activo, provisional, motor,
  semanas_seguridad, semanas_lead_time, semanas_reorden, semanas_inv_maximo,
  meses_promedio, capacidad_contenedor_m3, moneda, notas
) VALUES (
  'asia', 'Asia / Contenedor', 40, true, true, 'reorden',
  NULL, NULL, NULL, NULL,
  2, 70, 'USD',
  'Mismo motor que Darnel («nos serviria para Darnel y los proveedores de Asia»). '
  'Sin alcance y sin parametros propios: el libro del 20-ago solo trae Darnel y nadie ha '
  'declarado los codigos ni el lead time de Asia. Los NULL se muestran como «sin definir».'
) ON CONFLICT (slug) DO NOTHING;

UPDATE modelo_proveedor SET motor = 'reyma' WHERE slug IN ('reyma', 'carvajal');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · LA CAPTURA DEL MODELO — una fila por producto y modelo
-- ─────────────────────────────────────────────────────────────────────────────
-- Sólo lo que se CAPTURA o se trae de otra fuente. Nada calculado: cobertura,
-- estado y pedido se derivan en el motor, del lado de la aplicación, igual que
-- en Reyma. Guardar un resultado junto a sus insumos es garantizar que algún
-- día discrepen.

CREATE TABLE IF NOT EXISTS reorden_inventario (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  modelo        VARCHAR(40) NOT NULL REFERENCES modelo_proveedor(slug),
  codigo        VARCHAR(40) NOT NULL,          -- código Plasticentro
  cod_proveedor VARCHAR(60),                   -- código del proveedor
  descripcion   TEXT,
  um            VARCHAR(20),

  -- ⚠️ La conversión fardos → millares depende de este número. Sin él no se
  -- puede calcular nada, así que la carga retiene la fila en vez de asumir.
  und_fardo     NUMERIC(15,4),
  cub_millar    NUMERIC(12,6),                 -- m³ por millar

  -- Inventario, en FARDOS tal como se captura
  sj            NUMERIC(15,4) NOT NULL DEFAULT 0,
  z11           NUMERIC(15,4) NOT NULL DEFAULT 0,
  zacapa        NUMERIC(15,4) NOT NULL DEFAULT 0,
  peten         NUMERIC(15,4) NOT NULL DEFAULT 0,
  patios_sj     NUMERIC(15,4) NOT NULL DEFAULT 0,
  pend_surtir_sj      NUMERIC(15,4) NOT NULL DEFAULT 0,
  pend_surtir_peten   NUMERIC(15,4) NOT NULL DEFAULT 0,
  pend_surtir_zacapa  NUMERIC(15,4) NOT NULL DEFAULT 0,

  -- Tránsito PENDIENTE: pedido en fábrica, sin despachar, sin fecha (en ML).
  transito_pendiente  NUMERIC(15,4) NOT NULL DEFAULT 0,

  venta_proy_mensual  NUMERIC(15,4),           -- ML/mes
  precio_ml           NUMERIC(15,4),           -- USD por millar

  -- Del libro de precios, que es donde el dato está limpio: ACTIVO,
  -- LIQUIDACION o SIN MOV. En el motor del xlsx esta regla está ROTA por un
  -- `#REF!`, así que hoy ningún producto se excluye por liquidación aunque 11
  -- deberían. Se toma de la fuente que sí funciona.
  estado_producto     VARCHAR(20) NOT NULL DEFAULT 'ACTIVO'
                      CHECK (estado_producto IN ('ACTIVO','LIQUIDACION','SIN MOV.')),

  origen        VARCHAR(40) NOT NULL DEFAULT 'xlsx-20260820',
  autor         VARCHAR(500),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (modelo, codigo)
);

COMMENT ON TABLE reorden_inventario IS
  'Captura del modelo de punto de reorden (A4.27). Inventario en FARDOS, transito '
  'y venta en MILLARES. Solo insumos: cobertura, estado y pedido se calculan en '
  'lib/inventarios/reorden.ts.';

CREATE INDEX IF NOT EXISTS idx_reorden_inventario_modelo
  ON reorden_inventario (modelo, codigo);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · TRÁNSITO CONFIRMADO — normalizado a filas
-- ─────────────────────────────────────────────────────────────────────────────
-- En el libro son CUATRO COLUMNAS con la fecha metida en el encabezado
-- («18/Ago», «26/Jun»…). Eso no escala: cada embarque nuevo es una columna
-- nueva, y una columna nueva rompe cualquier mapeo por posición. Acá cada
-- embarque es una fila con su fecha, que además permite contestar «¿cuándo
-- entra?» — la misma pregunta que el drill-down de tránsito resolvió del otro
-- lado.

CREATE TABLE IF NOT EXISTS reorden_transito (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  modelo      VARCHAR(40) NOT NULL REFERENCES modelo_proveedor(slug),
  codigo      VARCHAR(40) NOT NULL,
  -- Fecha de llegada declarada. NULL sólo si el embarque existe sin fecha.
  fecha       DATE,
  cantidad_ml NUMERIC(15,4) NOT NULL,
  referencia  VARCHAR(64),                     -- proforma o embarque
  origen      VARCHAR(40) NOT NULL DEFAULT 'xlsx-20260820',
  autor       VARCHAR(500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE reorden_transito IS
  'Transito CONFIRMADO (en aguas, con fecha de llegada) del modelo de reorden. '
  'Una fila por embarque; en el xlsx eran columnas fechadas.';

CREATE INDEX IF NOT EXISTS idx_reorden_transito_modelo
  ON reorden_transito (modelo, codigo, fecha);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · PRECIOS POR PROFORMA
-- ─────────────────────────────────────────────────────────────────────────────
-- El precio se versiona por proforma, con su número y su fecha. El libro trae
-- tres versiones y DOS EN EL MISMO MES (09/07 y 23/07), así que la cadencia no
-- es mensual: es por proforma. Guardarlo como historia permite la alerta de
-- precio que del lado de Reyma ya existe (A4.24).

CREATE TABLE IF NOT EXISTS reorden_precios (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  modelo      VARCHAR(40) NOT NULL REFERENCES modelo_proveedor(slug),
  codigo      VARCHAR(40) NOT NULL,
  proforma    VARCHAR(40),                     -- 'DNV0013333'
  fecha       DATE,
  precio_ml   NUMERIC(15,4) NOT NULL,
  moneda      VARCHAR(8) NOT NULL DEFAULT 'USD',
  origen      VARCHAR(40) NOT NULL DEFAULT 'xlsx-20260820',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (modelo, codigo, proforma)
);

COMMENT ON TABLE reorden_precios IS
  'Historial de precios por proforma (USD/millar). Dos proformas pueden caer en '
  'el mismo mes: la cadencia es por proforma, no mensual.';

CREATE INDEX IF NOT EXISTS idx_reorden_precios_modelo
  ON reorden_precios (modelo, codigo, fecha DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · RLS y permisos de ruta — misma postura que el resto
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE reorden_inventario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reorden_inventario_service" ON reorden_inventario;
CREATE POLICY "reorden_inventario_service" ON reorden_inventario
  FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE reorden_transito ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reorden_transito_service" ON reorden_transito;
CREATE POLICY "reorden_transito_service" ON reorden_transito
  FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE reorden_precios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reorden_precios_service" ON reorden_precios;
CREATE POLICY "reorden_precios_service" ON reorden_precios
  FOR ALL USING (auth.role() = 'service_role');

INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT v.role, '/api/inventarios/reorden', ARRAY['GET'],
       'Modelo de punto de reorden — Darnel y Asia (A4.27)'
FROM (VALUES ('admin'), ('gerencia'), ('inventario')) AS v(role)
WHERE NOT EXISTS (
  SELECT 1 FROM route_permissions rp
  WHERE rp.role = v.role AND rp.route_pattern = '/api/inventarios/reorden'
);
