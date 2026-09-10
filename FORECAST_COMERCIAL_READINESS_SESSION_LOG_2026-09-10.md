# Forecast comercial — auditoría de listo-para-hoy y correcciones

**Fecha:** 2026-09-10 · **Disparador:** las credenciales ya están en manos de los
seis jefes de canal y tienen que cargar HOY. Pregunta de Jorge: ¿está lista la
página, el formulario, la entrega a Wilmer, el frontend y el backend?

**Contexto de fecha:** el cierre de captura de este ciclo es **mañana, viernes 11
de septiembre**; la reunión es el **miércoles 16**
(`docs/compras/DEFINICION_TERMINADO_FORECAST_COMERCIAL.md` §0).

---

## 1 · Verificación de producción (antes de tocar código)

Se corrió contra la base de producción, vía el editor SQL, un control de los
nueve objetos que crea la migración `20260901000006` más el seed de
`20260903000001`. **Los nueve dieron `true`**, y el conteo de datos dio:

| Control | Resultado |
|---|---|
| `comercial_areas` activas | **6** (incluye `zacapa` y `peten`) |
| usuarios `ventas` | **6** |
| usuarios `ventas` con `area` asignada | **6** |
| filas en `comercial_forecast` | **0** |

Es decir: la infraestructura estaba y está correcta en producción, y **nadie
había capturado todavía**. Ese cero es lo que hizo que las correcciones de abajo
salieran gratis: no hubo backfill, ni migración de datos, ni números que alguien
ya hubiera creído.

**Por qué se verificó el esquema y no el ledger de migraciones:** en este
proyecto las migraciones se aplican a mano en el editor SQL, así que
`supabase_migrations.schema_migrations` deriva en las dos direcciones. El
esquema es la respuesta; el ledger es una pista.

---

## 2 · Lo que ya estaba bien, y se deja constancia

`/comercial/forecast` (página, formulario y consolidado), `/api/comercial/forecast`,
`/api/comercial/productos`, el RBAC, la entrada del sidebar, el aterrizaje de
`ventas` en la página al ingresar, y el shell responsive (`fb786b0`). Nada de
eso se tocó.

---

## 3 · Defectos encontrados y corregidos

### 3.1 · El ciclo estaba corrido un mes — el más caro de los cinco

`cicloDelMes(mes)` calculaba el 2º viernes y el 3er miércoles **del mes propio**.
La definición de terminado dice lo contrario en cuatro lugares (§0, §1, §2 y §5),
y §5 no deja lugar a interpretación: *«las seis áreas cargaron su forecast de
**octubre** antes del viernes 11 de **septiembre**»*. El ciclo de un mes corre en
el mes ANTERIOR.

**Lo que costaba en pantalla:** al jefe de canal que elegía correctamente
*Octubre*, el banner le anunciaba *«la captura cierra el 9 de octubre — quedan 29
días»*, el día antes del cierre real. Le decía que lo de mañana era para dentro
de un mes.

La prueba que lo cubría afirmaba el mismo error de un mes: se escribió desde la
implementación, no desde la especificación. Corregida y comentada.

### 3.2 · El formulario abría en el mes equivocado

`setMes(m => m || j.mesesAbiertos[0])` abría en el mes EN CURSO (septiembre),
cuya captura cerró el mes pasado. Nuevo `mesPorDefecto(hoy)`: el primer mes del
horizonte cuya captura sigue viva — hoy, octubre. El día del cierre cuenta como
abierto (se cierra al terminar ese viernes, no al empezarlo).

Un valor por defecto equivocado se equivoca en los seis canales a la vez.

### 3.3 · El Sugerido de Wilmer descartaba cinco de los seis canales

`rows.ts` se quedaba con la fila **más reciente** por producto (`if (!existing)`
sobre un orden `created_at DESC`). Con una fila por (área, mes, producto), seis
canales dejan seis filas del mismo código: Mayoreo 500 + Tiendas 300 +
Institucional 200 llegaba al Sugerido como **200**, mientras el consolidado de
`/comercial/forecast` mostraba **1,000**. El mismo dato, dos pantallas, dos
números, y ningún error en ningún lado.

Ese merge era correcto cuando `comercial_forecast` era append-only y la escribía
un solo comprador. Dejó de serlo el 2026-09-01 y nadie volvió sobre él.

### 3.4 · Todos los motivos entraban al pedido sin revisión

El merge ignoraba `motivo`, y `adic` alimenta `Sugerido = max(0, X) + adic`. O
sea que `temporada` y `critico` —que son PROYECCIÓN del canal— sumaban derecho
a la compra. El jefe de canal lo hacía leyendo en pantalla, literalmente, *«se
revisa en la reunión si el total pasa la proyección»*.

Es la dirección peligrosa: mover la compra sin que nadie la revise es de donde
salieron los **18 furgones de exceso** que documenta §1 de la definición.

Ahora sólo `extraordinaria` suma (importando `sumaDirecto` de
`lib/comercial/forecast.ts`, no reimplementando la regla). Lo que va a revisión
se acumula aparte y **se muestra sin sumarse**: un número que nadie ve no se
puede discutir en la reunión, y uno que se suma solo no se discute nunca.

### 3.4b · Y el total tampoco decía QUIÉN pedía CUÁNTO (corregido el mismo día)

La primera corrección de 3.4 dejó `Adic.` como **una sola columna**: el total
que entra al pedido, con la parte a revisión anotada al lado. Jorge lo rechazó
en el acto, y con razón — es el mismo defecto que 3.4, un nivel más adentro, y
rompe la regla que el propio `rows.ts` ya tenía escrita para `adicComercial` vs
`sugBodega`: *«un aditivo que no dice de dónde salió es un número que nadie
puede defender»*. Ante «Adic. 800», ni el comprador puede preguntarle a nadie
por qué, ni el canal defender su número en la reunión.

`Adic.` queda como el total que entra, y a su derecha va **una columna por
canal**, generada desde `comercial_areas` (no una lista en el código: la
migración 20260901000006 dejó dicho que un canal nuevo no debe necesitar
despliegue, y ya se agregaron dos a los tres días). En cada celda, arriba lo
que entra al pedido y debajo en gris `N rev.`, la proyección que se discute.
En el xlsx son **dos columnas por canal** —`Mayoreo` y `Mayoreo (rev.)`—
porque en una hoja de cálculo se filtran por separado.

Las columnas por canal son de sólo lectura: `ClaveOrden` es una unión fija y
los canales son datos, así que ordenar y filtrar por rango siguen viviendo en
`Adic.`. Una prueba nueva verifica que el desglose **reconcilia** con los
totales — si no, vuelven a ser dos números para el mismo dato.

### 3.5 · Octubre no llegaba a Wilmer en absoluto

`monthStart` era el mes del calendario, así que todo lo capturado para octubre
—el mes que este ciclo existe para cubrir— era invisible en el vivo, en el
export y en el Sugerido hasta el 1 de octubre: dos semanas después de la reunión
que tenía que usarlo. Ahora usa `mesPorDefecto`, la misma regla que abre la
pantalla de captura, importada de un solo lugar para que las dos no puedan
discrepar.

### 3.6 · Ruta legacy que sólo podía devolver 500

`POST /api/compras/reabastecimiento/comercial` validaba contra el vocabulario
viejo (`adicional`, `normal_critica`), insertaba `area ?? null` contra una
columna que ahora es NOT NULL con FK, conocía sólo cuatro áreas (nunca supo de
Zacapa ni Petén), y era un `INSERT` pelado que esquivaba el índice único. Ningún
consumidor en el frontend, pero `20260908000001` le había dejado el permiso en
pie a `compras`: alcanzable hoy por Wilmer con la credencial que ya tiene.

Ruta borrada + migración `20260910000001` que retira el permiso, con verificación
en la misma transacción y rollback exacto anotado.

---

## 4 · Lo que NO se hizo, y por qué

**Ítem 5 — la semántica de `bodega`.** La captura escribe `bodega` NULL (el
canal proyecta lo que va a vender, no dónde se guarda), y `rows.ts` trata NULL
como «todas las bodegas» aplicando la cantidad completa a cada una. Con el
motivo ya filtrado el riesgo baja mucho, pero sigue siendo una decisión de
producto sin tomar: repartir por participación histórica, aplicarlo sólo a
`General`, o dejar la réplica. **Requiere decisión de Jorge; no se decidió
unilateralmente.**

---

## 5 · Verificación

- `npx tsc --noEmit` limpio.
- `npx jest` — **448/448** en 29 suites. La base era 435 en 28 suites, así que
  son **13 pruebas nuevas**.
- **Las pruebas del merge se verificaron contra el defecto**, no sólo contra el
  arreglo: corridas sobre el `rows.ts` viejo (con el resto del árbol en stash),
  las cinco de `consolidarComercial` **fallan**; sobre el nuevo, pasan. Una
  prueba que no se vio fallar no prueba nada.
- `npm run build` compila; `/api/compras/reabastecimiento/comercial` desaparecido
  de la tabla de rutas, `/api/comercial/{forecast,productos}` presentes.
- Pruebas nuevas: `consolidarComercial` extraída como función pura y exportada
  —es la regla que decide cuánto se compra de más, tiene que poder probarse— con
  cinco casos, incluido «con cero capturas el Sugerido vale exactamente lo que
  valía antes».

**Sin commitear al cierre de esta sesión.** `rows.ts` y `lib.ts` traían cambios
sin commitear de la sesión anterior (el refactor de paginado, `paginado.ts`); lo
de acá va montado encima y conviene separarlo antes de commitear.

**Pendiente de aplicar a mano:** `supabase/migrations/20260910000001_retirar_ruta_comercial_legacy.sql`.
