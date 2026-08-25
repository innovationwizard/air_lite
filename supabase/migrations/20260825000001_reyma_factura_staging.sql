-- A12 — Alexis carga sus propias facturas de REYMA desde la app.
--
-- EL PROBLEMA (medido 2026-08-25): el único camino entre el PDF que Alexis
-- manda por WhatsApp y `reyma_facturas_pdf` pasa por Jorge en una terminal, y
-- se rompe justo cuando hay prisa. Se rompe de dos maneras y sólo una se ve:
--   * la factura no se carga  → visible, rompe el correlativo G-nnn
--     (pasó con G-226 y con G-230);
--   * la factura se carga SIN el ETA → invisible, porque la ETA calculada se
--     ve idéntica a una real. **20 de 26 facturas están así hoy.**
--
-- POR QUÉ UNA TABLA DE STAGING Y NO UN ROUND-TRIP DEL JSON PARSEADO.
-- La carga es en dos pasos: (1) se sube el PDF y el servicio ML lo lee y evalúa
-- las reglas, (2) Alexis elige destino y ETA y confirma. Si el paso 1 devolviera
-- las líneas al navegador y el paso 2 las mandara de vuelta, cualquiera con una
-- sesión de rol `inventario` podría postear cantidades y precios arbitrarios a
-- `reyma_facturas_pdf`. El veredicto tiene que quedar del lado del servidor
-- entre los dos pasos: esta tabla es la FRONTERA DE CONFIANZA, no una
-- comodidad. De regalo evita que el teléfono resuba 1.5 MB y deja rastro de las
-- cargas que se empezaron y no se terminaron.
--
-- `parse` guarda el veredicto COMPLETO del servicio (cabecera, líneas, filas
-- listas, retenidas, errores, flags) tal como vino. Es procedencia: permite
-- reconstruir después por qué una factura entró como entró, sin volver a
-- parsear el PDF.
--
-- El PDF mismo va al bucket privado `reyma-facturas` (abajo). Hoy la
-- procedencia de estos documentos vive en el nombre de un archivo en la carpeta
-- de alguien; a partir de acá vive junto al dato, con su sha256.
--
-- Aplicada con `supabase db push`. Idempotente.

CREATE TABLE IF NOT EXISTS reyma_factura_staging (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),   -- el "ticket" del paso 2
  sha256        CHAR(64) NOT NULL,                   -- del PDF, verbatim
  archivo       VARCHAR(255) NOT NULL,               -- nombre original tal cual
  guia          VARCHAR(20),                         -- 'G-236-2026' cuando se pudo leer
  factura       VARCHAR(20),                         -- 'F172784'
  folio_fiscal  VARCHAR(36),                         -- UUID SAT
  storage_path  VARCHAR(500) NOT NULL,               -- bucket privado reyma-facturas
  parse         JSONB NOT NULL,                      -- veredicto completo del servicio ML
  -- pendiente  : subida, esperando que el usuario confirme destino y ETA
  -- cargada    : ya escribió en reyma_facturas_pdf
  -- descartada : el usuario la abandonó, o el documento no era cargable
  estado        VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente', 'cargada', 'descartada')),
  autor         VARCHAR(500) NOT NULL,               -- quién la subió (sesión)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  cargada_at    TIMESTAMPTZ
);

-- La cola de trabajo del día: lo pendiente, más reciente primero.
CREATE INDEX IF NOT EXISTS idx_reyma_factura_staging_estado
  ON reyma_factura_staging (estado, created_at DESC);
-- «¿esta factura ya la subí?» — se pregunta por el archivo, antes de tener
-- folio (el folio sólo existe si el parseo funcionó).
CREATE INDEX IF NOT EXISTS idx_reyma_factura_staging_sha256
  ON reyma_factura_staging (sha256);

-- RLS: misma postura que el resto de las tablas reyma_* — sólo service_role
-- escribe y lee; los reads del usuario pasan por la API con requireAuth.
ALTER TABLE reyma_factura_staging ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reyma_factura_staging_service" ON reyma_factura_staging;
CREATE POLICY "reyma_factura_staging_service" ON reyma_factura_staging
  FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket PRIVADO para los PDFs. Es la primera vez que la app usa Storage, así
-- que el default importa: `public = false`. Los archivos se sirven únicamente
-- por URL firmada desde el servidor — nunca por URL directa. Un CFDI trae RFC,
-- montos y sellos digitales; no tiene por qué ser legible por quien adivine la
-- ruta.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('reyma-facturas', 'reyma-facturas', false, 15728640, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Sin políticas de storage para roles de usuario: el acceso va por el cliente
-- service-role del servidor, igual que las tablas. Añadir una política aquí
-- sería abrir un segundo camino al mismo dato.

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos de ruta (defense-in-depth: matriz en datos + requireAuth en el
-- handler). Sin estas filas el middleware responde 403 aunque el handler lo
-- permita. Espejo de CAN_VIEW_INVENTARIOS — superuser pasa por bypass.
INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT v.role, v.ruta, v.metodos, v.descripcion
FROM (VALUES
  ('inventario', '/api/inventarios/reyma/factura/extraer', ARRAY['POST'],
   'Subir una factura PDF de REYMA y leerla (paso 1 de la carga)'),
  ('gerencia',   '/api/inventarios/reyma/factura/extraer', ARRAY['POST'],
   'Subir una factura PDF de REYMA y leerla (paso 1 de la carga)'),
  ('admin',      '/api/inventarios/reyma/factura/extraer', ARRAY['POST'],
   'Subir una factura PDF de REYMA y leerla (paso 1 de la carga)'),
  ('inventario', '/api/inventarios/reyma/factura/cargar',  ARRAY['GET', 'POST'],
   'Confirmar destino y ETA y cargar la factura (paso 2) · GET: cargas del día'),
  ('gerencia',   '/api/inventarios/reyma/factura/cargar',  ARRAY['GET', 'POST'],
   'Confirmar destino y ETA y cargar la factura (paso 2) · GET: cargas del día'),
  ('admin',      '/api/inventarios/reyma/factura/cargar',  ARRAY['GET', 'POST'],
   'Confirmar destino y ETA y cargar la factura (paso 2) · GET: cargas del día')
) AS v(role, ruta, metodos, descripcion)
WHERE NOT EXISTS (
  SELECT 1 FROM route_permissions rp
   WHERE rp.role = v.role AND rp.route_pattern = v.ruta
);
