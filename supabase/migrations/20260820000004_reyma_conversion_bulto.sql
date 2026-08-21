-- N12 RESUELTO — la bolsa poliseda se factura POR PESO y se compra por millar.
--
-- REYMA factura las bolsas en rollo con unidad `KGM` (kilos) a un precio por
-- kilo ÚNICO para todas las medidas, mientras que Suplicentro las compra y las
-- vende por rollo. La cantidad impresa en el CFDI (2,012.50) NO es la cantidad
-- comprable: el conteo de bultos viaja en la COLA DE LA DESCRIPCIÓN («… 101
-- BLTS»).
--
-- ALEXIS, verbatim (llamada 2026-08-20):
--   «ellos facturan por kilo y me dan el precio por kilo mientras que nosotros
--    facturamos por rollo»
--   «para los tres productos el mismo precio es porque ellos facturan todo por
--    kilo… es indiferente el tamaño y cada uno pesa distinto»
--   «él lo pone en la descripción, no está como que en la cantidad»
--
-- ⚠️ POR QUÉ NO SE DERIVA DEL PESO — Alexis, verbatim:
--   «no podemos poner como que un peso estándar porque… bueno cada rollo pesa
--    un kilo y medio, pero resulta que en algún momento, por centavos, no va a
--    cuadrar la factura en cuanto a montos»
-- Un peso promedio por rollo NO reconcilia al centavo. Por eso la conversión
-- parte de los BULTOS impresos (enteros exactos), no de los kilos.
--
-- DECISIÓN (Jorge, misma llamada, verbatim):
--   Jorge: «puedes leer la de la descripción, los 101 bultos, y te vas por ese
--          lado» · Alexis: «sí puedo» · Jorge: «vamos por ese lado, pásame la
--          tablita y con eso hago la conversión»
-- De las dos alternativas que ofreció Alexis (dividir el importe entre el
-- precio unitario, o leer los bultos × rollos por bulto) se eligió la SEGUNDA.
--
-- LA REGLA:  cantidad_comprable (ML/millar de Odoo) = BLTS × rollos_por_bulto
--
-- La tablita la mandó Alexis por WhatsApp el 2026-08-20
-- (docs/docs-alexis/added-aug20/): columnas CODIGO FACTUR. · CONCEPTO ·
-- ROLLOS X BULTO · UNIDAD FACTURA. `UNIDAD FACTURA = MILLAR` en las 5 filas, y
-- MILLAR es exactamente la UoM de compra de esos productos en Odoo (`ML`) — o
-- sea 1 rollo = 1 millar = 1 ML, consistente con el sufijo del nombre en Odoo
-- (`¨15/1000`, `¨10/1000`, `¨8/1000`).
--
-- Historial append-only, última fila por código manda (mismo patrón que
-- reyma_eta_config / reyma_nc_config): si REYMA cambia el empaque, se agrega
-- una fila y la anterior queda como historia.
-- Aplicada con `supabase db push`. Idempotente.

CREATE TABLE IF NOT EXISTS reyma_conversion_bulto (
  id               UUID PRIMARY KEY DEFAULT uuidv7(),
  codigo           VARCHAR(20) NOT NULL,      -- SKU Suplicentro
  rollos_por_bulto NUMERIC(10,4) NOT NULL CHECK (rollos_por_bulto > 0),
  unidad_factura   VARCHAR(20) NOT NULL,      -- 'MILLAR' — como lo rotula Alexis
  concepto         VARCHAR(120) NOT NULL,     -- verbatim de la tablita
  autor            VARCHAR(500) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reyma_conversion_bulto_codigo
  ON reyma_conversion_bulto (codigo, created_at DESC);

ALTER TABLE reyma_conversion_bulto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reyma_conversion_bulto_service" ON reyma_conversion_bulto;
CREATE POLICY "reyma_conversion_bulto_service" ON reyma_conversion_bulto
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE reyma_conversion_bulto IS
  'Rollos por bulto para los productos que REYMA factura por peso (KGM). '
  'cantidad_comprable = BLTS de la descripción × rollos_por_bulto. Tablita de '
  'Alexis, 2026-08-20. Ver N12 en docs/docs-alexis/MANIFEST.md.';

-- Semilla: la tablita de Alexis, las 5 filas tal como las mandó.
INSERT INTO reyma_conversion_bulto (codigo, rollos_por_bulto, unidad_factura, concepto, autor)
SELECT v.codigo, v.rollos, 'MILLAR', v.concepto,
       'Alexis, tablita por WhatsApp 2026-08-20 (docs/docs-alexis/added-aug20/) — '
       'columna ROLLOS X BULTO; regla acordada en la llamada del mismo día: '
       'cantidad = BLTS de la descripción × rollos por bulto'
FROM (VALUES
  ('77206360', 24, 'BOLSA EN ROLLO 6X10 MEX'),
  ('77206361', 20, 'BOLSA EN ROLLO 7X10 MEX'),
  ('77206362', 15, 'BOLSA EN ROLLO 8X11 MEX'),
  ('77206363', 10, 'BOLSA EN ROLLO 9X15 MEX'),
  ('77206364',  8, 'BOLSA EN ROLLO 12X18 MEX')
) AS v(codigo, rollos, concepto)
WHERE NOT EXISTS (SELECT 1 FROM reyma_conversion_bulto);

-- ── Captura verbatim en las líneas de factura PDF.
--
-- Hasta hoy `reyma_facturas_pdf.cantidad` era la cantidad impresa Y la cantidad
-- comprable, porque coincidían (X4G ≡ caja, XPK ≡ fardo). Con KGM dejan de
-- coincidir. Se separan, en vez de sobrescribir el dato del documento:
--   * cantidad       — SIEMPRE en la unidad de compra de Odoo (lo que netea
--                      contra reyma_po_lineas). Es lo que ya usaba saldos.ts.
--   * cantidad_cfdi  — lo que dice el papel, verbatim (2,012.50).
--   * unidad         — la unidad del papel, verbatim ('KGM', 'X4G', 'XPK').
--   * bultos         — el conteo que viaja en la descripción, insumo de la
--                      conversión. NULL cuando el documento no lo trae.
-- Cuando no hay conversión (X4G/XPK) cantidad = cantidad_cfdi y bultos es NULL.
ALTER TABLE reyma_facturas_pdf ADD COLUMN IF NOT EXISTS unidad        VARCHAR(8);
ALTER TABLE reyma_facturas_pdf ADD COLUMN IF NOT EXISTS cantidad_cfdi NUMERIC(12,4);
ALTER TABLE reyma_facturas_pdf ADD COLUMN IF NOT EXISTS bultos        NUMERIC(12,4);

COMMENT ON COLUMN reyma_facturas_pdf.cantidad IS
  'Cantidad en la UNIDAD DE COMPRA de Odoo (la que netea contra reyma_po_lineas). '
  'Para KGM = bultos × reyma_conversion_bulto.rollos_por_bulto; para X4G/XPK = '
  'la cantidad impresa.';
COMMENT ON COLUMN reyma_facturas_pdf.cantidad_cfdi IS
  'Cantidad tal como la imprime el CFDI, sin convertir. Difiere de `cantidad` '
  'sólo cuando el proveedor factura en otra unidad (KGM).';
COMMENT ON COLUMN reyma_facturas_pdf.bultos IS
  'Bultos declarados en la cola de la descripción («… 101 BLTS»). Insumo de la '
  'conversión; NULL cuando el documento no lo trae.';
