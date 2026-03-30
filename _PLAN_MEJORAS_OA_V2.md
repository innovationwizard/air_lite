# Plan de Mejoras: Modulo OA v2 — Basado en Respuestas del Cliente

**Fuente**: _Respuestas.pdf (respuestas a preguntas criticas) + Especificaciones.pdf + _ODOO_EXPLORATION_RESULTS.md
**Fecha**: 2026-03-30
**Estado**: STALE — Superseded by _PLAN_MEJORAS_OA_V3.md (2026-03-30)
**Nota**: Este documento contiene estimaciones que resultaron incorrectas (volumen de productos, match de IDs). Ver V3 para datos corregidos.

---

## Resumen de Hallazgos de las Respuestas

### R1 — Tiempos de Descarga
- Cada proveedor tiene tiempos diferentes
- Deben ser **configurables inicialmente** y **auto-recalcularse** con data historica
- Debe permitir **ajuste manual** tambien
- Los campos Odoo (`x_studio_inicio_carga`, `x_studio_terminacin_carga`) existen y el cliente acepta empezar a usarlos

### R2 — Capacidad de Almacenaje
- Tienen el **volumen de cada bodega en m3** (espacio total disponible)
- Tienen el **volumen por producto** en Odoo (74.6% de productos tienen `product.product.volume`)
- El espacio es **dinamico**: entra producto, sale producto vendido
- Se debe respetar el **maximo fisico** de la bodega
- **REGLA CRITICA**: Productos de exportacion (Carvajal/El Salvador, Reyma/Mexico) **NO se pueden pausar ni reducir una vez enviada la orden** — pueden venir ya en barco o ruta terrestre

### R3 — Reporte Automatizado
- Va a los **encargados de compra**
- Proposito: identificar que esta pasando y reaccionar
- Canales deseados: **WhatsApp + email + dashboard al ingresar**
- Los 3 canales son deseados

### R4 — Bodega Virtual (Drop-Ship)
- **No existe aun** en Odoo
- El cliente dice "la podremos crear como la necesites"
- Modulo diferido hasta que la creen

### R5 — Rampas y Horarios
- **Bodega Central**: 5 rampas
- **Bodega Zacapa**: 1 rampa
- **Bodega Peten**: 1 rampa
- **Bodega Zona 11**: 1 rampa
- Rango de trabajo para descarga: **6:00 AM a 6:00 AM** (capacidad 24h)
- Turnos laborales: **6:00 AM - 3:00 PM** y **3:00 PM - 12:00 AM**
- Horas efectivas de descarga: **18 horas/dia** (6 AM a 12 AM)

---

## CAMBIOS REQUERIDOS EN EL SISTEMA EXISTENTE

### Cambio 1: Agregar campo `volume_m3` a tabla `products`

**Problema**: La tabla `products` no tiene campo de volumen. Sin volumen por producto, no podemos calcular espacio ocupado en bodega.

**Datos disponibles**: Odoo tiene `product.product.volume` con 74.6% de cobertura (1,215 de 1,628 productos).

**Accion**:
- Agregar columna `volume_m3 NUMERIC(12,6)` a tabla `products`
- Importar los valores de `product.product.volume` desde Odoo para los 1,215 productos que lo tienen
- Los 413 productos sin volumen quedan como NULL — el sistema los excluira de calculos volumetricos y los reportara como "volumen desconocido"

### Cambio 2: Agregar campo `is_export` a tabla `products`

**Problema**: No hay forma de diferenciar productos de importacion/exportacion. Esto es critico porque los productos de exportacion (Carvajal/El Salvador, Reyma/Mexico) **no se pueden cancelar ni pausar** una vez ordenados.

**Accion**:
- Agregar columna `is_export BOOLEAN NOT NULL DEFAULT false` a tabla `products`
- Agregar columna `supplier_origin VARCHAR(50)` para indicar pais de origen del proveedor (ej: 'el_salvador', 'mexico', 'guatemala')
- El calculo de Hold List debe excluir productos marcados como `is_export = true` de las recomendaciones de detencion
- El dashboard debe mostrar advertencia: "Este producto es de exportacion — no se puede pausar ni reducir una vez ordenado"

### Cambio 3: Poblar `warehouse_config` con datos reales de las 4 bodegas

**Accion**: Insertar registros iniciales con los datos proporcionados:

| Bodega | Rampas | Horario Inicio | Horario Fin | Turnos |
|--------|--------|----------------|-------------|--------|
| Central | 5 | 06:00 | 00:00 | 6AM-3PM, 3PM-12AM |
| Zacapa | 1 | 06:00 | 00:00 | 6AM-3PM, 3PM-12AM |
| Peten | 1 | 06:00 | 00:00 | 6AM-3PM, 3PM-12AM |
| Zona 11 | 1 | 06:00 | 00:00 | 6AM-3PM, 3PM-12AM |

Nota: `max_capacity_m3` por bodega debe ser proporcionado por el cliente. El campo existe pero no tenemos los valores.

### Cambio 4: Calculo de Espacio Dinamico en Bodega

**Spec original**: "Se debe respetar el espacio maximo de la bodega ya que no podra entrar mas producto."

**Logica nueva**: Nueva funcion RPC `rpc_oa_warehouse_space`:
```
Espacio Ocupado = SUM(inventory_on_hand * product.volume_m3) por warehouse
Espacio Disponible = warehouse_config.max_capacity_m3 - Espacio Ocupado
Espacio Entrante = SUM(transitos_confirmados * product.volume_m3)
Espacio Post-Entrada = Espacio Disponible - Espacio Entrante
```

Si `Espacio Post-Entrada < 0`:
- Disparar alerta de **"Saturacion de Espacio Fisico"**
- La Lista de Despacho Sugerida debe ajustar cantidades para no exceder capacidad

Si `Espacio Post-Entrada < 10%` del total:
- Alerta amarilla: "Bodega cerca de capacidad maxima"

### Cambio 5: Proteccion de Productos de Exportacion en Hold List

**Regla de negocio critica**: Una vez que se envia una orden a Carvajal (El Salvador) o Reyma (Mexico), **no se puede reducir ni pausar** porque el producto puede venir en barco o ruta terrestre.

**Implementacion**:
- La funcion `rpc_oa_hold_list` debe incluir un campo `is_export` en su respuesta
- Si `is_export = true`, el producto aparece en el Hold List pero con flag `cancellable = false`
- UI: Fila del Hold List muestra badge "Exportacion — No cancelable" en rojo
- La Lista de Despacho Sugerida NO debe incluir reducciones para productos de exportacion

### Cambio 6: Tiempos de Descarga Auto-Recalculables

**El cliente quiere**:
1. Configuracion manual inicial (ya soportada en `unloading_times`)
2. Auto-recalculo basado en datos historicos
3. Override manual cuando sea necesario

**Implementacion**:
- Agregar columna `is_manual_override BOOLEAN DEFAULT false` a `unloading_times`
- Agregar columna `calculated_hours NUMERIC(5,2)` para el valor auto-calculado
- Agregar columna `sample_count INT DEFAULT 0` para cuantas mediciones se usaron
- Cuando se registre un evento de descarga completado (status `completed` en `reception_schedule`), calcular tiempo real: `actual_hours = completed_at - started_at`
- Funcion de recalculo: `AVG(actual_hours)` de las ultimas N descargas del mismo tipo/proveedor
- Si `is_manual_override = true`, usar `estimated_hours` (valor manual). Si no, usar `calculated_hours`
- Agregar columnas `started_at TIMESTAMPTZ` y `completed_at TIMESTAMPTZ` a `reception_schedule` para registrar tiempos reales

### Cambio 7: Multi-Bodega en Recepcion

**Problema actual**: `rpc_oa_reception_saturation` toma LIMIT 1 de warehouse_config. Con 4 bodegas, necesita ser parametrizado.

**Accion**: Modificar el RPC para recibir `p_warehouse_id INT` y filtrar por bodega. El UI de recepcion debe tener un selector de bodega.

### Cambio 8: Dashboard de Espacio en Bodega

**Pagina nueva**: `/oa/espacio-bodega`

**Contenido**:
- Selector de bodega (Central, Zacapa, Peten, Zona 11)
- Barra de capacidad: Espacio Total vs Ocupado vs Disponible vs Entrante
- Tabla por producto: SKU, Nombre, Unidades en Bodega, Volume por Unidad (m3), Volumen Total Ocupado (m3), % del Espacio
- Alerta si Espacio Post-Entrada < 0

### Cambio 9: Notificacion en Dashboard al Ingresar

**El cliente quiere**: Alertas visibles al momento de hacer login.

**Implementacion** (lo que SI podemos hacer ahora):
- Componente `OAAlertBanner` en el layout autenticado
- Al cargar la app, hacer fetch a `/api/oa/exceptions` y `/api/oa/reception?date=today`
- Si hay items en Hot List o saturacion de rampa: mostrar banner de alerta en la parte superior
- Banner tipo: "5 productos en quiebre inminente — Ver Excepciones"
- Click en el banner navega a la pagina correspondiente
- Roles: solo visible para `CAN_VIEW_OA`

### Cambio 10: Multi-Bodega en Net Inventory y Excepciones

**Problema actual**: `rpc_oa_net_inventory` calcula inventario global (sin filtrar por bodega). Para un sistema multi-bodega real, necesitamos poder filtrar por bodega.

**Accion**: Agregar parametro opcional `p_warehouse_id INT DEFAULT NULL` a todas las funciones RPC de OA. Si se proporciona, filtrar `inventory_daily` por `warehouse_id`. Agregar selector de bodega en las paginas de excepciones y dashboard proveedor.

---

## NUEVAS FUNCIONALIDADES

### Nueva Funcionalidad 1: Calculo de Espacio Dinamico (RPC)

Funcion: `rpc_oa_warehouse_space(p_warehouse_id INT DEFAULT NULL)`

Retorna:
- `warehouse_id`, `warehouse_name`
- `max_capacity_m3` — Capacidad total
- `occupied_m3` — SUM(qty_on_hand * product.volume_m3) para productos con volumen conocido
- `incoming_m3` — SUM(transit_qty * product.volume_m3)
- `available_m3` — max_capacity - occupied
- `post_arrival_m3` — available - incoming
- `saturation_pct` — (occupied / max_capacity) * 100
- `products_without_volume` — Conteo de productos sin volume_m3
- `alert_level` — 'verde' (< 80%), 'amarillo' (80-95%), 'rojo' (> 95% o post_arrival < 0)

### Nueva Funcionalidad 2: Pagina de Espacio en Bodega

Pagina: `/oa/espacio-bodega`

- Selector de bodega
- Barra visual de capacidad (verde/amarillo/rojo)
- Metricas: Capacidad Total, Ocupado, Disponible, En Transito, Post-Entrada
- Tabla de productos ordenada por volumen ocupado (descendente)
- Productos sin volumen listados aparte con advertencia
- Alertas de saturacion

### Nueva Funcionalidad 3: Banner de Alertas en Login

Componente: `OAAlertBanner` en layout autenticado.

- Fetch de excepciones y saturacion al cargar
- Banner superior con resumen de alertas criticas
- Navegacion directa a las paginas de accion

### Nueva Funcionalidad 4: Proteccion de Exportacion en Hold List

- Campo `is_export` en respuesta del Hold List
- UI diferenciada para productos no cancelables
- Advertencia clara: "En transito internacional — no se puede pausar"

---

## ORDEN DE IMPLEMENTACION

### Fase 1: Schema + Data (Migration)
1. Agregar `volume_m3` a `products`
2. Agregar `is_export`, `supplier_origin` a `products`
3. Agregar `started_at`, `completed_at` a `reception_schedule`
4. Agregar `is_manual_override`, `calculated_hours`, `sample_count` a `unloading_times`
5. INSERT datos reales de warehouse_config para las 4 bodegas
6. Importar `product.product.volume` de Odoo para los 1,215 productos

### Fase 2: RPC Functions
7. `rpc_oa_warehouse_space` — Calculo de espacio dinamico
8. Modificar `rpc_oa_reception_saturation` — Agregar `p_warehouse_id`
9. Modificar `rpc_oa_net_inventory` — Agregar `p_warehouse_id`
10. Modificar `rpc_oa_hold_list` — Excluir productos de exportacion de recomendaciones de detencion
11. Modificar `rpc_oa_hot_list` — Agregar campo `is_export`

### Fase 3: API Routes
12. `/api/oa/warehouse-space` — Espacio dinamico por bodega
13. `/api/oa/alerts` — Resumen de alertas para banner
14. Actualizar rutas existentes para soportar `warehouse_id` param

### Fase 4: UI
15. Pagina `/oa/espacio-bodega`
16. Componente `OAAlertBanner`
17. Selector de bodega en excepciones, dashboard proveedor, recepcion
18. Proteccion de exportacion en Hold List
19. Agregar bodega al sidebar

### Fase 5: Mejoras de Recepcion
20. Formulario de registro de descarga completada (started_at, completed_at)
21. Auto-recalculo de tiempos promedio
22. Selector de bodega en recepcion

---

## LIMITACIONES DEL SISTEMA MEJORADO

### Limitacion 1: Sin Odoo Live Sync
La app trabaja con datos importados. El inventario, pedidos, y transitos pueden tener **horas o dias de retraso** respecto a Odoo. Los calculos de espacio dinamico y net inventory seran tan precisos como la ultima importacion de datos.

**Impacto**: Las alertas de quiebre o saturacion podrian llegar tarde si los datos no se refrescan frecuentemente.

### Limitacion 2: Capacidad Maxima (m3) por Bodega Desconocida
El cliente dice que tiene el volumen de cada bodega, pero **no proporciono los valores exactos** en las respuestas. El campo `max_capacity_m3` existe pero necesita ser llenado por el cliente.

**Impacto**: Sin este dato, el calculo de espacio dinamico mostrara 0% de saturacion. La alerta de "Saturacion de Espacio Fisico" no funcionara hasta que se configure.

### Limitacion 3: 25.4% de Productos Sin Volumen
413 de 1,628 productos no tienen `volume` en Odoo. Estos productos se excluyen de calculos volumetricos.

**Impacto**: El espacio calculado como "ocupado" sera una subestimacion. El sistema mostrara un conteo de "productos sin volumen" para que el equipo sepa cuanto sesgo hay en el calculo.

### Limitacion 4: Sin Notificaciones Push (Email/WhatsApp)
El cliente quiere reportes por WhatsApp, email, y dashboard. Solo el **dashboard** es implementable ahora. Email y WhatsApp requieren infraestructura adicional (SendGrid/Resend para email, WhatsApp Business API para WhatsApp).

**Impacto**: Los encargados de compra deben entrar al dashboard manualmente para ver alertas. No recibiran notificaciones proactivas.

### Limitacion 5: Bodega Virtual No Existe
El cliente dijo que la creara en Odoo, pero aun no existe. El modulo de entregas directas (drop-ship) esta diferido.

**Impacto**: No hay aislamiento de inventario para furgones directos fabrica-cliente. Todo el inventario se trata como bodega principal.

### Limitacion 6: Sin Data Historica de Tiempos de Descarga
Los campos de Odoo `x_studio_inicio_carga` y `x_studio_terminacin_carga` tienen 0% de datos poblados. El auto-recalculo de tiempos no tendra data historica para arrancar.

**Impacto**: Los tiempos de descarga arrancan con los valores manuales que ingrese el cliente. Se volveran mas precisos conforme se registren descargas en el sistema.

### Limitacion 7: Sin Clasificacion de Productos de Exportacion
No hay forma automatica de saber cuales productos son de exportacion. El campo `is_export` debe ser poblado manualmente o derivado de los proveedores (Carvajal/Reyma = exportacion).

**Impacto**: Hasta que se configure, todos los productos del Hold List apareceran como cancelables, lo cual es incorrecto para productos de exportacion.

---

## RECOMENDACIONES PARA EL FUTURO: CAMBIOS DE BAJO ESFUERZO CON ALTO IMPACTO

Estas son acciones que el equipo operativo puede tomar **desde hoy** con esfuerzo minimo, que mejoraran dramaticamente la precision del sistema a futuro.

### 1. Empezar a registrar tiempos de descarga en Odoo (ALTO IMPACTO)

**Que hacer**: En cada descarga de furgon, registrar en Odoo los campos `x_studio_inicio_carga` (hora de inicio) y `x_studio_terminacin_carga` (hora de fin) en el `stock.picking` correspondiente.

**Esfuerzo**: Minimo — los campos ya existen en Odoo, solo hay que empezar a llenarlos.

**Impacto**: En 1-2 meses, el sistema tendra suficiente data historica para auto-calcular tiempos de descarga reales por proveedor y tipo de unidad. Esto elimina la dependencia de estimaciones manuales y habilita alertas de congestion precisas.

### 2. Completar volumen (m3) de los 413 productos faltantes (ALTO IMPACTO)

**Que hacer**: Revisar los 413 productos en Odoo que no tienen `product.product.volume` y agregar su volumen en m3.

**Esfuerzo**: Moderado — requiere medicion o consulta al proveedor. Priorizar los productos de alta rotacion (clase A del ABC) primero.

**Impacto**: Pasa la cobertura de volumen de 74.6% a 100%. El calculo de espacio en bodega pasa de ser una subestimacion a ser exacto. Las alertas de saturacion se vuelven confiables.

### 3. Asignar vehiculo a cada despacho en Odoo (MEDIO IMPACTO)

**Que hacer**: Al despachar un furgon, seleccionar el vehiculo en el campo `x_studio_vehculo` del `stock.picking`.

**Esfuerzo**: Minimo — el campo existe, solo hay que usarlo. 1 click por despacho.

**Impacto actual**: Solo 4 de 196K entregas tienen vehiculo asignado (0.0%). Con cobertura, habilitamos: optimizacion de carga por capacidad del vehiculo, tracking de utilizacion de flota, y correlacion vehiculo-ruta-tiempo.

### 4. Registrar capacidad maxima (m3) de cada bodega (CRITICO)

**Que hacer**: Proporcionar el volumen maximo en m3 de cada una de las 4 bodegas (Central, Zacapa, Peten, Zona 11).

**Esfuerzo**: Minimo — es un dato que ya conocen ("nosotros tenemos el volumen de cada bodega en m3").

**Impacto**: Sin este dato, el modulo de espacio dinamico no puede funcionar. Es el dato faltante mas critico.

### 5. Clasificar productos de exportacion (CRITICO)

**Que hacer**: Marcar en el sistema cuales productos provienen de Carvajal (El Salvador) y Reyma (Mexico) como productos de exportacion/importacion. Esto puede hacerse via la relacion `product_suppliers` que ya existe — todos los productos con `supplier_id` apuntando a Carvajal o Reyma son candidatos.

**Esfuerzo**: Minimo — se puede derivar automaticamente de la tabla `product_suppliers`.

**Impacto**: Evita que el sistema recomiende pausar despachos de productos que ya estan en transito internacional. Previene el error operativo mas costoso del flujo OA.

### 6. Empezar a usar campo de Ruta en despachos (BAJO IMPACTO INICIAL)

**Que hacer**: En cada despacho, seleccionar la ruta en `x_studio_ruta_departamentales` (actualmente 0% poblado, pero las opciones ya estan definidas: Rutas Locales, Costa Sur, Sur Occidente, Oriente, etc.).

**Esfuerzo**: Minimo — 1 click por despacho.

**Impacto**: Habilita analisis de demanda por zona geografica, optimizacion de rutas de entrega, y programacion de flota por zona. Valor a mediano plazo.

### 7. Crear la Bodega Virtual en Odoo para Drop-Ship (MEDIO ESFUERZO)

**Que hacer**: Crear una ubicacion virtual (`stock.location`) en Odoo para los despachos directos fabrica-cliente.

**Esfuerzo**: Requiere configuracion en Odoo por el admin.

**Impacto**: Habilita el aislamiento de datos necesario para el Hilo B del spec (pedidos back-to-back sin buffer). Previene que el inventario de clientes directos "contamine" los calculos de bodega central.

---

## PRIORIDAD DE RECOMENDACIONES (Ordenadas por impacto/esfuerzo)

| # | Recomendacion | Esfuerzo | Impacto | Urgencia |
|---|--------------|----------|---------|----------|
| 4 | Capacidad m3 de cada bodega | 5 min | CRITICO | Hoy |
| 5 | Clasificar productos de exportacion | 30 min | CRITICO | Hoy |
| 1 | Registrar tiempos de descarga | 1 min/descarga | ALTO | Empezar hoy |
| 2 | Completar volumen de productos | 1-2 semanas | ALTO | Esta semana |
| 3 | Asignar vehiculo a despachos | 1 click/despacho | MEDIO | Empezar hoy |
| 6 | Usar campo de Ruta | 1 click/despacho | BAJO | Cuando sea posible |
| 7 | Crear Bodega Virtual | 1-2 horas | MEDIO | Cuando haya drop-ships |

---

## RELACION CON DOCUMENTOS EXISTENTES

| Documento | Relacion |
|-----------|----------|
| `_PLAN_ORDENES_ABIERTAS.md` | Plan original — este documento lo extiende con las respuestas del cliente |
| `_ODOO_EXPLORATION_RESULTS.md` | Confirma datos disponibles (fleet, product volume, warehouse data) |
| `_Respuestas.pdf` | Fuente directa de las respuestas analizadas |
| `Especificaciones.pdf` | Spec original del flujo OA |
| `_deep_refactor_authoritative_client_feedback.md` | Feedback del cliente: "Optimizacion por cubicaje (CBM) y llenado de contenedores" es requisito clave |
