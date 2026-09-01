-- EL MODELO DE ALEXIS SE VUELVE PARAMETRIZABLE — A4.26 / A6.20.
--
-- LO QUE SE PIDIÓ, textual (13-ago): *«Ese mismo modelo hay que replicarlo en
-- Carvajal, vos. ES EL MISMO. Solo que ya no van a ser 6 furgones a la semana.
-- En Carvajal son más… entre 15 y 20. Semanales.»*
--
-- Esa frase decide la arquitectura entera: **Carvajal no es un motor nuevo, es
-- el motor de Reyma con otros números.** Construir un segundo motor sería
-- garantizar que se separen — la parte más cara de este proyecto es la paridad
-- de 2,752 celdas contra el libro de Alexis, y duplicarla es perderla dos veces.
--
-- Entonces esta migración no agrega lógica: le saca los números al motor y los
-- pone en datos. Reyma se siembra con EXACTAMENTE los valores que ya estaban
-- fijos en el código, así que su comportamiento no cambia en nada — es la misma
-- disciplina que la separación Zacapa/Petén, que se hizo reasignando filas de
-- una tabla de configuración y no tocando el cálculo.
--
-- ⚠️ LOS PARÁMETROS QUE NO SE SABEN QUEDAN EN NULL, NO EN UN DEFAULT.
-- De Carvajal hay cuatro números confirmados en transcripción y varios que
-- NADIE ha dicho nunca: su lead time, sus días de despacho, su stock de
-- seguridad. Rellenarlos con los de Reyma daría una pantalla que se ve
-- terminada y miente; en NULL, la página los muestra como «sin definir» y esa
-- celda vacía es una pregunta visible para Alexis. Mismo criterio que la
-- insignia de «pendiente desconocido» y que las dos columnas de ETA.
--
-- Aplicada con `supabase db push`. Idempotente.

CREATE TABLE IF NOT EXISTS modelo_proveedor (
  slug            VARCHAR(40) PRIMARY KEY,
  nombre          VARCHAR(80) NOT NULL,
  orden           INT NOT NULL DEFAULT 100,   -- posición en la navegación
  activo          BOOLEAN NOT NULL DEFAULT true,

  -- Provisional = el alcance de productos se DERIVÓ y nadie lo confirmó.
  -- La página lo dice en pantalla; ver la nota de `reyma_products.modelo`.
  provisional     BOOLEAN NOT NULL DEFAULT false,

  -- ── parámetros del plan de despacho ─────────────────────────────────────
  capacidad_m3        NUMERIC(10,2),   -- Reyma: furgón de 100 m³
  max_furgones_dia    INT,             -- tope diario del comprador
  furgones_semana     INT,             -- ritmo observado (Reyma 6, Carvajal 15-20)
  dias_despacho       TEXT[],          -- Reyma: sin jueves (llegaría en domingo)
  cod_comodin         VARCHAR(40),     -- con qué se rellena un furgón incompleto
  desc_comodin        VARCHAR(120),

  -- ── parámetros del pedido ───────────────────────────────────────────────
  semanas_seguridad   NUMERIC(6,2),    -- Reyma: 1 semana
  lead_time_dias      INT,             -- Reyma: 4 días hábiles hasta bodega
  objetivo_semanas    NUMERIC(6,2),    -- nivelación regional; Reyma: 3
  alzas_precio_anio   INT,             -- cadencia observada de cambios de precio

  notas           TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE modelo_proveedor IS
  'Parametros por modelo de proveedor. El MOTOR es uno solo (el de Reyma, con '
  'paridad verificada); lo que cambia entre modelos son estos numeros. NULL = '
  'no se sabe, y la pantalla lo muestra como «sin definir» en vez de suponerlo.';

-- ── REYMA: los valores que HOY están fijos en el código ─────────────────────
-- No es una decisión nueva; es mover a datos lo que ya regía. Cada número tiene
-- su origen: 100 m³ y sin jueves (Alexis 04-ago), 6 furgones/día compartidos con
-- compras locales, comodín vaso térmico 10, seguridad 1 semana + lead time de 4
-- días hábiles (04-ago), nivelación regional a 3 semanas (04-ago).
INSERT INTO modelo_proveedor (
  slug, nombre, orden, provisional, capacidad_m3, max_furgones_dia, furgones_semana,
  dias_despacho, cod_comodin, desc_comodin, semanas_seguridad, lead_time_dias,
  objetivo_semanas, alzas_precio_anio, notas
) VALUES (
  'reyma', 'Reyma', 10, false, 100, 6, 6,
  ARRAY['Lunes','Martes','Miércoles','Viernes'], '77201046', 'Vaso térmico No. 10',
  1, 4, 3, 1,
  'Modelo validado contra el libro de Alexis: 2,752 de 2,752 celdas en paridad. '
  'No despacha jueves porque llegaria sabado y entraria en domingo.'
)
ON CONFLICT (slug) DO NOTHING;

-- ── CARVAJAL: sólo lo que está verificado en transcripción ─────────────────
-- Confirmado (13-ago, 04-ago, 10-ago): 15-20 furgones POR SEMANA contra los 6
-- de Reyma; comodín = bandeja dos; 2-3 alzas de precio al año contra 1.
-- SIN CONFIRMAR y por eso en NULL: capacidad del furgón, tope diario, días de
-- despacho, semanas de seguridad, lead time, objetivo de nivelación.
INSERT INTO modelo_proveedor (
  slug, nombre, orden, provisional, capacidad_m3, max_furgones_dia, furgones_semana,
  dias_despacho, cod_comodin, desc_comodin, semanas_seguridad, lead_time_dias,
  objetivo_semanas, alzas_precio_anio, notas
) VALUES (
  'carvajal', 'Carvajal', 20, true, NULL, NULL, 18,
  NULL, NULL, 'Bandeja dos', NULL, NULL, NULL, 3,
  'Mismas reglas que Reyma con otros numeros: «Es el mismo» (13-ago). '
  'Los 18 furgones/semana son el punto medio del rango 15-20 que se dijo; el '
  'resto de los parametros NADIE los ha declarado y quedan en NULL a proposito. '
  'ALCANCE PROVISIONAL: los codigos se derivaron de los proveedores Carvajal en '
  'Odoo, no de una lista que alguien haya confirmado.'
)
ON CONFLICT (slug) DO NOTHING;

-- ── El discriminador de alcance ─────────────────────────────────────────────
-- `reyma_products` ya era la tabla de ALCANCE (55 códigos con `en_alcance`).
-- Agregarle el modelo la convierte en la tabla de alcance de TODOS los modelos
-- sin tocar ninguna de las tablas derivadas: todas se llavean por `codigo`, así
-- que el filtro por modelo viaja por join en vez de por otra columna en cada
-- tabla. Menos superficie, menos formas de que se desincronicen.
ALTER TABLE reyma_products
  ADD COLUMN IF NOT EXISTS modelo VARCHAR(40) NOT NULL DEFAULT 'reyma'
    REFERENCES modelo_proveedor(slug);

CREATE INDEX IF NOT EXISTS idx_reyma_products_modelo
  ON reyma_products (modelo) WHERE en_alcance;

COMMENT ON COLUMN reyma_products.modelo IS
  'A que modelo pertenece el codigo. Las 55 filas existentes quedan en «reyma» '
  'por el default, asi que el alcance previo no se mueve.';

ALTER TABLE modelo_proveedor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "modelo_proveedor_service" ON modelo_proveedor;
CREATE POLICY "modelo_proveedor_service" ON modelo_proveedor
  FOR ALL USING (auth.role() = 'service_role');

-- Permisos de ruta — refleja CAN_VIEW_INVENTARIOS.
INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT v.role, '/api/inventarios/modelos', ARRAY['GET'],
       'Catalogo de modelos de proveedor de inventarios (A6.20)'
FROM (VALUES ('admin'), ('gerencia'), ('inventario')) AS v(role)
WHERE NOT EXISTS (
  SELECT 1 FROM route_permissions rp
  WHERE rp.role = v.role AND rp.route_pattern = '/api/inventarios/modelos'
);
