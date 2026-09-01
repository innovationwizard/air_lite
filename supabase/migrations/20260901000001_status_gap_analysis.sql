-- GAP ANALYSIS COMO PÁGINA VIVA — `/status`.
--
-- QUÉ ES. El entregable del 31-ago era un xlsx (T001 del corpus
-- `docs/gap-analysis-corpus-aug31/`). Se entrega como página dentro de la app
-- porque un xlsx se congela el día que se manda, y la crítica estándar a una
-- matriz de trazabilidad es exactamente esa: tratada como entregable de una
-- sola vez se pudre. La página se corrige cuando el cliente objeta una fila.
-- El xlsx sigue existiendo, como exportación de esta misma fuente.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUÉ DOS TABLAS Y NO UNA. Es la decisión de diseño de esta migración.
--
-- `status_items` es un ESPEJO del repositorio, no un original. Su contenido se
-- genera desde dos TSV versionados en git (`items.tsv`, inmutable, + el juicio
-- en `juicio.tsv`) y `scripts/sync_status.py` lo sobrescribe entero en cada
-- corrida. Eso es deliberado: el juicio de estado se revisa en un diff, se
-- atribuye a un commit y se revierte, igual que el corpus se trató a sí mismo.
--
-- `status_plan` es lo contrario: nace en la interfaz y NO tiene copia en el
-- repositorio. Son las fechas y el orden de prioridad que escribe el rol
-- `project_manager`. Si fueran columnas de `status_items`, el siguiente
-- `sync_status.py --commit` las borraría sin avisar — silenciosamente, porque
-- un upsert no sabe distinguir «esta columna la escribió una persona». Dos
-- tablas hacen que esa clase de pérdida sea imposible por construcción y no
-- por disciplina.
--
-- REPARTO DE AUTORIDAD, que es también el acuerdo con el cliente:
--   * el ESTADO (¿está hecho?) lo juzga quien construyó — vía TSV + sync;
--   * el PLAN  (¿cuándo?)      lo escribe el PM del cliente — vía interfaz.
-- Ninguno de los dos puede pisar al otro. `project_manager` no tiene ruta que
-- escriba `status_items`; el sync no toca `status_plan`.
--
-- ────────────────────────────────────────────────────────────────────────────
-- REGLA DE CONTEO (0/100). `funcionando` exige construido Y confirmado por el
-- cliente. `construido` es código en producción que nadie del cliente validó,
-- y NO cuenta como terminado. Es la regla que el corpus ya se había impuesto
-- (R12: «ENTREGADO = mostrado funcionando en sesión; no implica aceptación»),
-- y es la contramedida documentada al síndrome del 90%: el porcentaje mide
-- aceptación, no esfuerzo consumido. Medido al escribir esta migración, la
-- diferencia entre las dos lecturas es de 17 puntos.
--
-- LO QUE NO ENTRA. Dos exclusiones, ambas enumeradas en el QUALITY GATE del
-- script para que sean auditables y no una pérdida silenciosa:
--   * E1-E7 (términos comerciales) — no son ítems a construir y nunca lo
--     fueron, y la página la abren los usuarios finales;
--   * las filas cuyo contenido es una valoración de desempeño de personas
--     viajan con `visible_ui = false`: informan el juicio y no se renderizan.
--     R03 ya decía que las filas de tipo evidencia informan el juicio y no lo
--     sustituyen. Nunca fueron entregables, así que tampoco salen del
--     denominador — no estaban en él.
--
-- Aplicada con `supabase db push`. Idempotente.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · LOS HECHOS + EL JUICIO
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS status_items (
  id              TEXT PRIMARY KEY,        -- 'A4.22' · 'B1.13' — id jerárquico del corpus
  cat             TEXT NOT NULL,           -- 'A4' → categories.tsv
  orden_natural   INT  NOT NULL,           -- posición en items.tsv; el orden de lectura (R01)

  -- ── copiado verbatim del corpus, nunca editado acá ───────────────────────
  item            TEXT NOT NULL,
  tipo            TEXT NOT NULL,           -- vocabulario R08
  flag            TEXT,                    -- 'CREEP' | 'CREEP small' | 'CONTRA'
  src             TEXT NOT NULL,           -- '26-ago L117-167' — fecha + archivo + líneas (R05)
  -- `ref` (la cita verbatim) NO se carga. Vive en items.tsv, para el entorno de
  -- desarrollo. Las citas son justamente donde aparecen los juicios sobre
  -- personas, y la auditabilidad la sostiene `src`: con fecha, archivo y líneas
  -- cualquiera va al transcript. La cita era una comodidad de lectura.
  notes           TEXT,

  -- ── el juicio ────────────────────────────────────────────────────────────
  estado          TEXT NOT NULL CHECK (estado IN (
                    'funcionando',    -- construido Y confirmado por el cliente
                    'construido',     -- en producción, sin confirmación
                    'parcial',        -- «Parcial o en construcción»
                    'no_construido',
                    'fuera_alcance',  -- C1-C6 y decisiones de exclusión
                    'no_software',    -- contexto, evidencia, prerrequisito, cronología
                    'sin_determinar') -- el corpus no alcanza; requiere juicio humano
                  ),
  -- true mientras la fila lleve el estado que sugirió el análisis y no el que
  -- confirmó una persona. La interfaz lo dibuja con borde punteado. Es R03
  -- («el juez es humano») traducido a una columna.
  estado_sugerido BOOLEAN NOT NULL DEFAULT true,
  evidencia       TEXT,                    -- por qué ese estado: medición, ruta de código, fecha

  origen          TEXT NOT NULL CHECK (origen IN (
                    'contrato',       -- A1-A8 y C — propuesta firmada 16-jun
                    'verbal',         -- B1-B3 — inclusiones verbales del cierre
                    'prerrequisito',  -- D — insumo que debe entregar el cliente
                    'anadido',        -- F, G y toda fila con flag CREEP
                    'contexto')),     -- H
  -- El eje `origen` es trazabilidad hacia atrás: responde «¿de qué requisito
  -- firmado desciende esta fila?». Las que no descienden de ninguno son, por
  -- definición de la disciplina, alcance que nunca se revisó formalmente. Es
  -- lo que alimenta el toggle de la página, cuyo valor por defecto excluye
  -- `anadido` — el denominador honesto es lo que se firmó.

  -- ── quién/qué está esperando ─────────────────────────────────────────────
  -- NOTA DE TONO, y es una regla de producto, no un detalle: la interfaz NUNCA
  -- nombra a la persona que retiene algo. `bloqueo` se rotula por función
  -- («nuestro», «del cliente», «de un tercero») y el detalle se da como
  -- SUSTANTIVO en `espera_que` — el insumo que falta, no quién lo debe. Un
  -- insumo nombrado se puede conseguir; una persona nombrada sólo se puede
  -- culpar. El hecho es el mismo y la fuente sigue en `src`.
  bloqueo         TEXT NOT NULL CHECK (bloqueo IN ('jorge','cliente','tercero','nadie','na')),
  espera_que      TEXT,                    -- 'la remedicion del volumen de las bolsas'

  -- A quien le sirve la fila. NO se deriva de `cat`: los dos compradores
  -- comparten A1-A8, asi que el area es juicio y viaja en juicio.tsv.
  -- `gerencia_proyecto` son las transversales — sincronizacion, accesos,
  -- capacitacion, habilitacion de correo, levantamiento de cubicaje: no le
  -- sirven a un silo, condicionan a todos, y su conduccion es de la gerencia
  -- del proyecto. Tienen semaforo propio porque repartirlas a dedo entre los
  -- otros tres seria inventar, y dejarlas sin area las haria invisibles en la
  -- vista de prontitud, que es mentir por omision.
  -- El rotulo es la FUNCION, no la persona que hoy la ocupa: un semaforo con
  -- el nombre de alguien encima es un veredicto sobre esa persona.
  area            TEXT NOT NULL CHECK (area IN (
                    'compras_local','compras_intl','gerencia','gerencia_proyecto','na')),
  temporada       TEXT NOT NULL CHECK (temporada IN ('critico','mejora','puede_esperar','na')),
  esfuerzo        TEXT NOT NULL CHECK (esfuerzo IN ('horas','dias','semanas','no_estimable','na')),
  -- Qué hace el usuario mientras tanto. Un defecto CON rodeo no pinta rojo:
  -- pinta ámbar y nombra el rodeo. Un ámbar sin rodeo escrito es un rojo
  -- disfrazado, que es el modo clásico en que el semáforo deja de informar.
  rodeo           TEXT,

  -- ── brecha de confirmación ───────────────────────────────────────────────
  -- Sólo para `construido`. Convierte un titular bajo en una acción de
  -- calendario: la aceptación es trabajo pendiente con dueño y criterio, igual
  -- que cualquier otra brecha, no un trámite posterior.
  -- INVARIANTE DE HONESTIDAD: si no se puede redactar el criterio, la fila NO
  -- está a una reunión de distancia y su estado sincero es `parcial`. Un
  -- «construido» sin criterio redactable es el síndrome del 90% con otro traje.
  confirmable_con     TEXT,                -- a quién hay que convocar
  criterio_aceptacion TEXT,                -- qué tendría que ver y qué tendría que decir

  -- false = informa el juicio, no se renderiza (ver cabecera).
  visible_ui      BOOLEAN NOT NULL DEFAULT true,

  -- Prioridad calculada por el sync: temporada × bloqueo × esfuerzo × estado.
  -- Es el orden POR DEFECTO del plan. `status_plan.prioridad` lo sobreescribe.
  orden_sugerido  INT,

  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE status_items IS
  'Gap analysis de /status. ESPEJO de docs/gap-analysis-corpus-aug31/{items,juicio}.tsv; '
  'lo sobrescribe scripts/sync_status.py. No editar a mano salvo por la ruta de superuser.';

-- El orden de lectura de la página, y el filtro que más se usa.
CREATE INDEX IF NOT EXISTS idx_status_items_orden ON status_items (orden_natural);
CREATE INDEX IF NOT EXISTS idx_status_items_estado ON status_items (estado, origen);
-- La cola de trabajo: crítico y sin terminar, por prioridad.
CREATE INDEX IF NOT EXISTS idx_status_items_plan
  ON status_items (orden_sugerido) WHERE estado IN ('parcial','no_construido');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · EL PLAN — lo único que se escribe desde la interfaz
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS status_plan (
  item_id         TEXT PRIMARY KEY REFERENCES status_items(id) ON DELETE CASCADE,
  prioridad       INT,                     -- orden manual; NULL = usar orden_sugerido
  fecha_objetivo  DATE,                    -- la escribe el PM, libre. La app no propone fechas.
  nota            TEXT,
  autor           TEXT NOT NULL,           -- sesión que escribió
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE status_plan IS
  'Fechas y orden de prioridad del plan. Dueño: rol project_manager. '
  'scripts/sync_status.py NUNCA la toca — por eso es tabla aparte y no columnas de status_items.';

-- La app no propone fechas: el corpus registra que se acordaron etapas
-- (1-sep / 15-sep / 1-oct) cuyo contenido nunca se definió (T006). Llenarlas
-- desde el documento sería inventar, así que la columna nace vacía y la llena
-- quien tiene autoridad para comprometer un calendario.

CREATE INDEX IF NOT EXISTS idx_status_plan_fecha ON status_plan (fecha_objetivo);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · RLS — misma postura que el resto del repositorio
-- ─────────────────────────────────────────────────────────────────────────────
-- Sólo `service_role`. Las lecturas del usuario pasan por la API con
-- requireAuth, y las escrituras del plan por una ruta que verifica el rol.

ALTER TABLE status_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "status_items_service" ON status_items;
CREATE POLICY "status_items_service" ON status_items
  FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE status_plan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "status_plan_service" ON status_plan;
CREATE POLICY "status_plan_service" ON status_plan
  FOR ALL USING (auth.role() = 'service_role');
