-- Ensancha `autor` de VARCHAR(120) a VARCHAR(500) en todas las tablas que lo usan.
--
-- MOTIVO (2026-08-14, cargando G-226): la columna se dimensionó para "quién hizo
-- esto" = displayName o email de una persona (user_profiles.display_name es
-- VARCHAR(100), así que 120 sobra para humanos). Pero en las tablas alimentadas
-- por INGESTA el mismo campo lleva PROCEDENCIA — de dónde salió el dato, con qué
-- validación y qué decisión quedó pendiente — y ahí 120 se queda corto: el POST
-- devolvió 400 y la línea no entró hasta acortar el texto a mano. Recortar
-- procedencia para que quepa es exactamente lo que no queremos (§ETL: capturar
-- verbatim, nunca perder el rastro).
--
-- 500 y no TEXT: sigue habiendo un tope como defensa, pero con espacio para una
-- frase de procedencia completa. Ensanchar un VARCHAR en Postgres no reescribe
-- la tabla (>= 9.2), así que es barato y sin bloqueo largo.
--
-- Se ensanchan TODAS por uniformidad: que nadie tenga que recordar cuáles son
-- "de persona" y cuáles "de ingesta" — el día que una tabla de personas reciba
-- una carga automática, ya tiene espacio.
--
-- El tope equivalente en código vive en frontend/src/app/api/inventarios/reyma/lib.ts
-- (helper `autor()`), actualizado en el mismo commit.
-- Aplicada con `supabase db push`. Idempotente.

ALTER TABLE reyma_proyeccion_overrides ALTER COLUMN autor TYPE VARCHAR(500);
ALTER TABLE reyma_nc_config            ALTER COLUMN autor TYPE VARCHAR(500);
ALTER TABLE reyma_furgon_notas         ALTER COLUMN autor TYPE VARCHAR(500);
ALTER TABLE reyma_plan_despacho        ALTER COLUMN autor TYPE VARCHAR(500);
ALTER TABLE reyma_precio_overrides     ALTER COLUMN autor TYPE VARCHAR(500);
ALTER TABLE reyma_pedido_mensual       ALTER COLUMN autor TYPE VARCHAR(500);
ALTER TABLE reyma_orden_global         ALTER COLUMN autor TYPE VARCHAR(500);
ALTER TABLE reyma_facturas_pdf         ALTER COLUMN autor TYPE VARCHAR(500);
ALTER TABLE bug_reports                ALTER COLUMN autor TYPE VARCHAR(500);

COMMENT ON COLUMN reyma_facturas_pdf.autor IS
  'Quién/qué originó la fila. En cargas de ingesta lleva la procedencia completa '
  '(fuente, fecha, validación, decisiones pendientes) — por eso VARCHAR(500).';
