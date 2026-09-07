-- BAJA DE `export_plan_draft` Y `export_plan_emitido` — el rastro del export viejo.
--
-- POR QUÉ SE VAN: el botón «Exportar Excel» se reescribió el 2026-09-07 para
-- exportar EXACTAMENTE la vista activa (`lib/compras/sugeridoExport.ts`). El
-- exportador anterior no lo hacía: releía por su cuenta las tres bodegas de
-- Carvajal y proponía cantidades con una fórmula propia (Sugerido ÷ cobertura
-- × 7), así que el archivo no podía coincidir con la pantalla. Wilmer reportó
-- los cuatro defectos el 26-ago (fuente equivocada, códigos de otro proveedor,
-- bodega equivocada, números sin origen) y los cuatro eran ese mismo hecho.
--
-- Estas dos tablas existían SÓLO para ese exportador:
--   * `export_plan_draft`   — el borrador del modal editable. El modal ya no
--     existe: la app no propone cantidades, así que no hay borrador que
--     guardar. La tabla nunca tuvo una sola fila (verificado 2026-09-07).
--   * `export_plan_emitido` — el registro de cada descarga, con la llave
--     (proveedor, semana, mes). Esa llave describe una hoja semanal por
--     proveedor, que es justamente el formato que se abandonó; el archivo
--     nuevo es una foto de una bodega en una fecha y no tiene «semana».
--
-- Las tres rutas que las escribían (`/export`, `/export/draft`,
-- `/export/emitido`) se eliminaron del código el mismo día. Ninguna otra ruta,
-- vista, función o sync leyó jamás estas tablas — eran INERTES por decisión
-- explícita (Jorge, 2026-08-21), y esa decisión es lo que hace que darlas de
-- baja no mueva ningún número que el cliente valide.
--
-- ⚠️ LOS DATOS SE ARCHIVARON ANTES, Y EL ARCHIVO NO ESTÁ EN ESTE REPO.
-- `export_plan_emitido` tenía 3 filas (627 líneas de detalle), las tres
-- descargas reales de Wilmer del 26-ago, 01-sep y 03-sep. Se volcaron a
-- `export_plan_emitido_archive/` en la raíz del proyecto ANTES de escribir
-- esta migración. Ese directorio cae bajo el patrón `*_archive/` del
-- .gitignore (línea 91): existe en la máquina de Jorge y NO en git. Quien
-- necesite esas filas después de aplicar esto tiene que pedírselas — no las va
-- a encontrar clonando el repositorio.
--
-- Son evidencia, no datos: es el único registro de los archivos que se le
-- entregaron a Wilmer mientras el export estuvo roto, con el sha256 de los
-- bytes que bajó. La fila del 26-ago contiene el defecto de códigos cruzados
-- literalmente — un archivo llamado «Carvajal» con productos de Envaica
-- (56601110 · VASO 16 OZ PP C/TAPA ENV 20/50).
--
-- SIN CASCADE, a propósito: si algo dependiera de estas tablas quiero que esto
-- FALLE y no que se lleve por delante un objeto que nadie revisó. Se verificó
-- el 2026-09-07 que no hay dependientes.
--
-- Aplicada con `supabase db push`. Idempotente.

-- 1. Las tablas. Con cada una se van sus índices, su política RLS, sus CHECK y
--    —en el caso de `emitido`— su trigger de inmutabilidad.
DROP TABLE IF EXISTS export_plan_draft;
DROP TABLE IF EXISTS export_plan_emitido;

-- 2. La función del trigger NO se va con la tabla: es un objeto suelto y
--    quedaría huérfana. Su único uso era el trigger de arriba.
DROP FUNCTION IF EXISTS export_plan_emitido_no_update();

-- 3. Los permisos de ruta de las tres rutas eliminadas (migraciones
--    20260821000003 / 000004 / 000005). El middleware `check_route_access`
--    compara por igualdad exacta, o por prefijo sólo cuando el patrón termina
--    en '*'; ninguno de estos tres lo hace, así que estas filas no gobiernan
--    ninguna otra ruta y borrarlas no le quita acceso a nada que siga vivo.
DELETE FROM route_permissions
 WHERE route_pattern IN (
   '/api/compras/reabastecimiento/export',
   '/api/compras/reabastecimiento/export/draft',
   '/api/compras/reabastecimiento/export/emitido'
 );
