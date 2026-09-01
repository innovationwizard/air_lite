-- ESTADO «ALGÚN DÍA» — el backlog que no es un descarte.
--
-- POR QUÉ HACE FALTA UN ESTADO MÁS, y no alcanzaba con los que había.
--
-- `fuera_alcance` significa DECIDIDO QUE NO: se discutió, se descartó, y
-- reabrirlo requiere una razón nueva (C1-C6). Es un cierre.
--
-- Pero hay pedidos que no están cerrados ni vivos: no se van a hacer ahora,
-- nadie los está esperando, y sin embargo siguen siendo buenas ideas que el día
-- que cambie una condición externa vuelven a tener sentido. Meterlos en
-- `fuera_alcance` los mata; dejarlos en `no_construido` los cuenta como deuda y
-- ensucia la lista de trabajo con cosas que nadie va a tomar. Ninguna de las
-- dos es honesta.
--
-- `algun_dia` es esa tercera cosa: fuera del alcance ACTUAL, sin descartar, con
-- la condición que lo reviviría escrita en `evidencia`. Sale del denominador
-- igual que `fuera_alcance` —no puede estar incompleto lo que no se está
-- haciendo— y se muestra en su propia sección, para que exista como registro y
-- no como reproche.
--
-- EL PRIMER CASO, y el que motivó el estado (2026-09-01): A4, línea de la
-- propuesta firmada — *«recomendaciones de compras exportables en CSV
-- importable a Odoo»*.
--
-- ⚠️ LA RAZÓN IMPORTA Y CONVIENE DEJARLA EXACTA, porque la versión imprecisa ya
-- causó un ida y vuelta. NO es «no tenemos permisos de escritura en Odoo»: un
-- archivo que una persona importa a mano NUNCA necesitó permisos de escritura,
-- y ese argumento ya se usó una vez para descartar esto y resultó no aplicar.
-- La razón real, verificada, es doble:
--   1. La importación masiva NO está habilitada en Odoo (registrado el 06-ago).
--   2. Habilitarla no está aprobado por quienes tendrían que aprobarlo, y el
--      cliente decidió expresamente seguir con copiar y pegar (2026-09-01).
-- Lo que el usuario pedía de verdad —*«yo no digito, me prefiero copiar y pegar
-- porque se me equivocó un código»*— se entregó por otra vía: el botón Copiar
-- pone la tabla visible en el portapapeles como TSV y se pega directo en la
-- grilla de Odoo, sin archivo de por medio.
--
-- Aplicada con `supabase db push`. Idempotente.

ALTER TABLE status_items DROP CONSTRAINT IF EXISTS status_items_estado_check;
ALTER TABLE status_items ADD CONSTRAINT status_items_estado_check
  CHECK (estado IN (
    'funcionando',
    'construido',
    'parcial',
    'no_construido',
    'fuera_alcance',   -- decidido que no; reabrirlo pide una razón nueva
    'algun_dia',       -- fuera del alcance actual, sin descartar
    'no_software',
    'sin_determinar'
  ));

COMMENT ON COLUMN status_items.estado IS
  'Estado 0/100. `funcionando` exige construido Y confirmado por el cliente. '
  '`fuera_alcance` y `algun_dia` salen del denominador: lo que no se esta '
  'haciendo no puede estar incompleto. La diferencia entre ambos es que '
  '`algun_dia` no esta descartado — lleva en `evidencia` la condicion que lo '
  'reviviria.';
