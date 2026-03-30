# Plan de Implementacion: Flujo de Gestion de Ordenes Abiertas (OA)

**Fuente**: Especificaciones.pdf + _ODOO_EXPLORATION_RESULTS.md
**Fecha**: 2026-03-26
**Estado**: IMPLEMENTADO (Fase 1-3) — 2026-03-26

---

## Resumen Ejecutivo

Las Especificaciones definen un sistema completo de gestion de ordenes abiertas para Carvajal (79 furgones/mes) y Reyma (40 furgones/mes). El sistema actual (AI Refill Lite) ya tiene:
- Datos historicos de inventario, ventas, compras y movimientos de stock
- Forecasting con Prophet ML
- Un POC de Programacion de Compras (2 semanas max inventory)
- Stockout risk analysis, ABC/XYZ classification

**Hallazgos criticos de la exploracion Odoo (2026-03-26):**
- Odoo 17 Enterprise (test env) con acceso a 15 modelos core (~8.1M records)
- `fleet.vehicle`: 29 vehiculos con `x_studio_cubicaje` (m3) — 22/29 tienen capacidad volumetrica
- `stock.picking`: 222K pickings, 95.3% tienen `amount_volume` (m3)
- `product.product`: 74.6% tienen `volume` > 0, pero solo 1 producto tiene `weight`
- Campos custom de carga (`x_studio_inicio_carga`, `x_studio_terminacin_carga`) existen pero estan 0% poblados
- 208 `stock.location` disponibles — necesitamos identificar la bodega virtual para drop-ship
- **No hay conector live aun** — todo el data actual es CSV import

Lo que **falta** es el modulo operativo completo de OA: planificacion semanal, comunicacion con proveedores, alertas en tiempo real, gestion de entregas directas, y dashboard de semaforo.

---

## PREGUNTAS CRITICAS PENDIENTES

> Sin estas respuestas, las decisiones de arquitectura quedan bloqueadas.

| # | Pregunta | Impacto |
|---|----------|---------|
| # | Pregunta | Impacto | Contexto Odoo |
|---|----------|---------|---------------|
| 1 | **Conexion Odoo en vivo vs. datos importados**: El spec requiere datos en tiempo real. Debemos construir un conector Odoo live o disenar con datos importados + refresh manual? | Define si necesitamos un servicio de sincronizacion | XML-RPC ya probado con `ml/odoo_explorer.py`. Acceso confirmado a 15 modelos. Factible tecnicamente. |
| 2 | **Tiempos de descarga por proveedor**: El spec dice "se debe definir por proveedor". Cuales son estos valores? O debemos crear una pagina de configuracion? | Afecta modulo de Ventanas de Recepcion | Odoo tiene `x_studio_inicio_carga` y `x_studio_terminacin_carga` en stock.picking pero 0% poblados. No hay data historica para inferir. |
| 3 | **Capacidad maxima de almacenaje**: Cuantas unidades/pallets/m3? Es global o por SKU/zona? | Afecta calculo de saturacion y alertas Hold | 208 stock.location en Odoo, 25 warehouses. Podriamos calcular en m3 dado que 74.6% de productos tienen volume. |
| 4 | **Reporte automatizado antes de 8 AM**: Quien lo recibe y como? (email, WhatsApp, dashboard, PDF?) | Define si necesitamos cron job + servicio de notificaciones | — |
| 5 | **Origen del Forecast mensual**: Es el Prophet ML ya existente, un upload manual, o un campo de Odoo? | Define flujo de entrada de datos de la OA | Prophet ML ya genera predicciones mensuales. Podriamos reutilizar `backtest_results.predicted_demand`. |
| 6 | **Bodega Virtual Odoo**: Cual es el nombre/ID de la ubicacion virtual para drop-ship? | Necesario para aislar datos en queries | 208 locations accesibles. Necesitamos saber cual es la virtual. Podemos listarlas. |
| 7 | **Numero de rampas/andenes y horario de bodega**: Cuantos andenes hay? Cual es el horario laboral? | Necesario para calculo de saturacion de recepcion | 118 `stock.picking.type` records. Podrian contener info de andenes pero necesita verificacion. |

---

## ANALISIS DE COMPLIANCE POR SECCION

### 1. Entrada de Datos Mensual (Cierre de Mes) — CONSTRUIBLE

**Spec pide**: Registro de OA Global + Plan Maestro de Despacho distribuido en S1-S4.

**Plan**:
- **Nueva pagina**: `/oa/plan-maestro` — Formulario para registrar la OA mensual por proveedor (Carvajal/Reyma)
- **Nueva tabla**: `open_orders` — OA header (supplier_id, month, total_qty, total_value, status)
- **Nueva tabla**: `open_order_lines` — Lineas por SKU (product_id, forecast_qty, unit_price)
- **Logica IA**: Distribucion automatica en 4 semanas (S1-S4) basada en Prophet forecast + stock actual
- **Nueva tabla**: `dispatch_plan_weeks` — Plan semanal generado (week_number, product_id, planned_qty)
- **Dependencia**: Pregunta 5 (origen del forecast)

### 2. Auditoria Semanal de Inventario — CONSTRUIBLE

**Spec pide**: Recalculo cada viernes, buffer de seguridad (max 1 semana, min 3 dias).

**Plan**:
- **Nueva pagina**: `/oa/auditoria-semanal` — Vista del recalculo semanal
- **Logica**: Extender la tabla `inventory_daily` existente o crear una vista materializada `weekly_audit`
- **Calculo de Inventario Neto**: `(inventory_on_hand + transitos_confirmados) - (pedidos_clientes_pendientes)`
  - `inventory_on_hand`: ya existe en `inventory_daily.quantity_on_hand`
  - `transitos_confirmados`: calculable desde `purchase_order_lines` WHERE state = 'purchase' y no recibido
  - `pedidos_pendientes`: calculable desde `sale_order_lines` WHERE delivered_qty < quantity
- **Reglas de negocio**: Parametrizables en `app_settings`:
  - `oa_max_stock_weeks`: 1 (25% del forecast mensual)
  - `oa_min_stock_days`: 3 (deteccion de quiebre)

### 3. Reporte Diario de Excepciones — CONSTRUIBLE

**Spec pide**: Hot List (< 3 dias) + Hold List (> 1 semana buffer).

**Plan**:
- **Nueva pagina**: `/oa/excepciones` — Dashboard diario con dos listas
- **Hot List (Alerta de Quiebre Inminente)**: Productos con Inventario Neto < 3 dias de venta promedio
  - Calculo: `inventario_neto / demanda_diaria_promedio < 3`
  - Fuente de demanda: `demand_daily` (ya existe, derivado de ventas reales)
- **Hold List (Orden de Detencion)**: Productos con Inventario Neto > 1 semana de buffer
  - Calculo: `inventario_neto / demanda_diaria_promedio > 7`
  - Incluye razon: "venta real X% por debajo del forecast"
- **API route**: `/api/oa/exceptions` — RPC function que calcula ambas listas
- **Exportable**: PDF/CSV para compartir con Carvajal y Reyma

### 4. Ciclo de Comunicacion con Proveedores — PARCIALMENTE CONSTRUIBLE

**Spec pide**: Reporte automatizado cada manana antes de 8 AM.

**Plan**:
- **Nueva pagina**: `/oa/reporte-proveedor` — Vista del reporte diario para compartir
- **Contenido**: % cumplimiento acumulado + Hot/Hold lists + Lista de Despacho Sugerida
- **Lista de Despacho Sugerida**: Cantidades ajustadas para no exceder capacidad de almacenaje
- **Generacion automatica de PDF**: Para envio por email/WhatsApp

**Lo que NO podemos hacer aun**:
- Envio automatico antes de 8 AM requiere un cron job (Railway scheduled task o Supabase Edge Function con pg_cron)
- El canal de comunicacion (email vs WhatsApp) necesita definirse (Pregunta 4)

### 5. Monitoreo de Cumplimiento (KPI de Facturacion) — CONSTRUIBLE

**Spec pide**: % Cumplimiento Semanal y Global + Alertas Roja/Amarilla.

**Plan**:
- **Nueva pagina**: `/oa/cumplimiento` — Dashboard de KPIs
- **Calculos**:
  - `% Cumplimiento Semanal = (Cant. Facturada semana / Plan Semanal Sugerido) * 100`
  - `% Cumplimiento Global = (Total Facturado mes / OA Global) * 100`
  - Fuente: `purchase_order_lines.received_qty` vs `dispatch_plan_weeks.planned_qty`
- **Alertas**:
  - Roja: cumplimiento semanal < 90% → "Riesgo de Quiebre de Stock"
  - Amarilla: despachos no solicitados → "Saturacion de Espacio Fisico"
- **Visualizacion**: Cards con semaforo + tabla detallada + grafica de tendencia

### 6. Ajuste Dinamico de Cuota Mensual — CONSTRUIBLE

**Spec pide**: Trigger de pedido extraordinario + logica de compra de emergencia.

**Plan**:
- **Logica integrada en la auditoria semanal** (no pagina separada, sino seccion dentro de `/oa/auditoria-semanal`)
- **Calculo de Proyeccion de Cierre**: `(Inventario Neto + Saldo Pendiente OA) - (Venta Proyectada al cierre)`
  - Venta Proyectada: Prophet forecast ya existente
- **Condicion de Alerta**: Si resultado < 25% del forecast del mes siguiente
- **Calculo de cantidad extraordinaria**: Cantidad para restablecer buffer 1 semana + cubrir lead time
- **Reporte de Desviacion**: Escenario A (venta > forecast) o B (retraso proveedor)

### 7. Dashboard de Semaforo para Proveedor — CONSTRUIBLE

**Spec pide**: Visualizacion Verde/Amarillo/Rojo por SKU.

**Plan**:
- **Nueva pagina**: `/oa/dashboard-proveedor` — Vista filtrable por proveedor (Carvajal/Reyma)
- **Semaforo por SKU**:
  - Verde: OA fluyendo segun plan
  - Amarillo: Sugerencia de adelantar despachos
  - Rojo: Necesidad de Ampliacion de OA (pedido extraordinario)
- **Logica**: Basado en Inventario Neto vs buffer vs tendencia de demanda
- **Responsive**: Optimizado para compartir pantalla o enviar screenshot al proveedor

### 8. Gestion de Ventanas de Recepcion — PARCIALMENTE CONSTRUIBLE

**Spec pide**: Calculo de saturacion, repriorización por Hot List, buffer de 30 min, gestion de horas extra.

**Plan**:
- **Nueva pagina**: `/oa/recepcion` — Calendario/timeline de recepciones del dia
- **Nuevas tablas**:
  - `warehouse_config` — Numero de rampas, horario laboral, tiempo de limpieza (30 min)
  - `unloading_times` — Tiempo de descarga por tipo de unidad y proveedor
  - `reception_schedule` — Arribos programados del dia con horarios
- **Calculos**:
  - Saturacion: `SUM(tiempos_descarga) > (horas_laborables * num_rampas)`
  - Repriorización: Ordenar por Hot List (< 3 dias stock primero)
  - Horas extra: Si despacho critico llega despues de 4 PM, evaluar riesgo de quiebre

**Lo que NO podemos hacer aun**:
- Los tiempos de descarga "se deben definir por proveedor" (Pregunta 2)
- Numero de rampas y horario de bodega (Pregunta 7)
- Se puede construir la pagina con campos configurables, pero necesitamos los valores reales

### 9. Entregas Directas (Drop-Ship / Bodega Virtual) — CONSTRUIBLE CON DATOS

**Spec pide**: Silo de datos, ordenes especiales, espacio en transito, alertas de desvio.

**Plan**:
- **Nueva pagina**: `/oa/entregas-directas` — Dashboard de furgones directos fabrica→cliente
- **Aislamiento de datos**: Filtro por `stock_locations` para excluir bodega virtual del inventario neto central
- **Reporte de Seguimiento Directo**: "Furgon para Cliente X, OC-Y. No cuenta para OA Global"
- **Lead Time de cliente especial**: Medicion desde pedido hasta facturacion
- **Dashboard de Capacidad de Fabrica**: Consolida bodega principal + furgones directos
- **Alerta de Desvio de Ruta**: Si cambio de ubicacion virtual → principal, recalcular plan

**Dependencia**: Pregunta 6 (identificador de bodega virtual en Odoo)

---

## COSAS QUE NO PODEMOS CUMPLIR HOY (y por que)

### 1. Sincronizacion en tiempo real con Odoo
**Spec**: "La IA debe conectarse directamente a la Ubicacion Virtual de Odoo"
**Realidad**: El sistema trabaja con datos importados por CSV. No hay conector live.
**Solucion propuesta**: Construir un servicio de sync Odoo → Supabase via XML-RPC. La exploracion ya confirmo acceso a todos los modelos necesarios (stock.move: 1M+ records, stock.picking: 222K, purchase.order: 3K, sale.order: 80K). El script `ml/odoo_explorer.py` ya autentica exitosamente.
**Estimacion**: Fase separada. Se requiere:
  - `ml/odoo_client.py` — Cliente XML-RPC reutilizable (ya planificado en Phase 3 del exploration plan)
  - Sync incremental por `write_date` para evitar full-pulls
  - Frequency: cada 15-30 min para datos transaccionales, cada hora para maestros
**Riesgo sin sync**: Los datos pueden tener dias de retraso, lo cual invalida la logica de "inventario neto en tiempo real" y las "alertas instantaneas".

### 2. Envio automatizado de reportes antes de 8 AM
**Spec**: "Reporte automatizado cada manana antes de las 8:00 AM"
**Realidad**: No hay infraestructura de cron jobs ni servicio de notificaciones.
**Solucion propuesta**: Railway cron job (ya es la plataforma del ML service) + canal de entrega por definir.
**Opciones de canal**:
  - Email (Resend/SendGrid) — mas simple, profesional
  - WhatsApp Business API — mas inmediato, pero requiere cuenta verificada
  - PDF en dashboard — implementable inmediatamente, sin infraestructura adicional

### 3. Recalculo instantaneo por desvio de ruta
**Spec**: "Al detectar un cambio de ubicacion... la IA debe recalcular instantaneamente"
**Realidad**: Sin webhook de Odoo ni conexion live, no podemos detectar cambios instantaneamente.
**Solucion propuesta**: Con Odoo sync (punto 1), implementar polling cada 15 min en `stock.picking` filtrando por `write_date` reciente y cambios de `location_dest_id`. Odoo 17 Enterprise soporta webhooks via `base.automation` pero requiere configuracion del lado Odoo.

### 4. Datos operativos faltantes
Los siguientes valores son necesarios pero no estan disponibles:

| Dato | Estado en Odoo | Solucion |
|------|---------------|----------|
| Tiempos de descarga (Carvajal/Reyma) | Campos existen (`x_studio_inicio_carga`, `x_studio_terminacin_carga`) pero 0% poblados | Config manual en app + empezar a poblar en Odoo |
| Numero de rampas/andenes | No existe en Odoo | Config manual en `warehouse_config` |
| Horario laboral de bodega | No existe en Odoo | Config manual en `warehouse_config` |
| Capacidad maxima almacenaje | No explicita, pero 74.6% de productos tienen `volume` (m3) | Config manual (m3 totales) + calculo automatico por product volume |
| Bodega Virtual (drop-ship) | 208 locations existen, necesitamos identificar cual | Listar locations y preguntar al usuario |

**Solucion**: Pagina de configuracion `/oa/configuracion` donde se ingresan estos parametros operativos.

### 5. Peso de productos (weight)
**Spec implica**: Calculos logisticos de carga
**Realidad**: Solo 1 de 1,628 productos tiene `weight` > 0 en Odoo. El cliente confirmo que **carga se maneja por volumen (m3), no por peso**.
**Impacto**: Podemos construir todo basado en m3. La tabla de parametros del spec (Furgon 53 pies, Contenedor 40/45 pies) se configura con capacidad en m3.
**No es un blocker** — es una adaptacion valida.

---

## ARQUITECTURA PROPUESTA

### Nuevas Tablas (Supabase Migration)

```
open_orders              — OA mensual por proveedor
open_order_lines         — Lineas de OA por SKU
dispatch_plan_weeks      — Plan semanal S1-S4 generado por IA
weekly_audits            — Snapshot de auditoria semanal (viernes)
exception_reports        — Hot/Hold lists diarias
extraordinary_orders     — Pedidos extraordinarios generados
warehouse_config         — Config operativa (rampas, horario, capacidad)
unloading_times          — Tiempos de descarga por tipo/proveedor
reception_schedule       — Programacion de recepciones del dia
direct_deliveries        — Entregas directas fabrica→cliente
```

### Nuevas Paginas

```
/oa/plan-maestro          — Registro de OA + Plan Maestro S1-S4
/oa/auditoria-semanal     — Recalculo semanal + pedidos extraordinarios
/oa/excepciones           — Hot List + Hold List diarios
/oa/cumplimiento          — KPIs de facturacion + alertas
/oa/dashboard-proveedor   — Semaforo visual por proveedor
/oa/recepcion             — Gestion de ventanas de recepcion
/oa/entregas-directas     — Drop-ship / Bodega Virtual
/oa/reporte-proveedor     — Reporte para compartir con proveedores
```

### Nuevas API Routes

```
/api/oa/open-orders       — CRUD de ordenes abiertas
/api/oa/dispatch-plan     — Generacion y consulta del plan S1-S4
/api/oa/audit             — Trigger y consulta de auditoria semanal
/api/oa/exceptions        — Hot/Hold lists
/api/oa/compliance        — KPIs de cumplimiento
/api/oa/extraordinary     — Pedidos extraordinarios
/api/oa/reception         — Programacion de recepciones
/api/oa/direct-deliveries — Entregas directas
/api/oa/supplier-report   — Generacion de reporte para proveedor
```

### Sidebar Navigation (nueva seccion)

```
"Ordenes Abiertas" (seccion)
  ├── Plan Maestro          → /oa/plan-maestro
  ├── Auditoria Semanal     → /oa/auditoria-semanal
  ├── Excepciones del Dia   → /oa/excepciones
  ├── Cumplimiento          → /oa/cumplimiento
  ├── Dashboard Proveedor   → /oa/dashboard-proveedor
  ├── Recepcion             → /oa/recepcion
  └── Entregas Directas     → /oa/entregas-directas
```

### RBAC (roles con acceso)

- **superuser, admin**: Acceso total + configuracion
- **gerencia**: Lectura de todos los dashboards
- **compras**: Acceso total a OA (su modulo principal)
- **inventario**: Auditoria semanal + excepciones + recepcion
- **ventas**: Solo lectura de excepciones y cumplimiento
- **financiero**: Cumplimiento + reportes

---

## ORDEN DE IMPLEMENTACION SUGERIDO

### Fase 1: Fundacion (Schema + Config)
1. Migration SQL con nuevas tablas
2. Pagina de configuracion de warehouse (rampas, horario, capacidad, tiempos de descarga)
3. Settings en `app_settings` para parametros de OA

### Fase 2: Core OA
4. Pagina de Plan Maestro (registro de OA + distribucion S1-S4)
5. Auditoria Semanal (calculo de inventario neto + reglas de buffer)
6. Reporte de Excepciones (Hot/Hold lists)

### Fase 3: KPIs y Comunicacion
7. Dashboard de Cumplimiento (% semanal/global + alertas)
8. Dashboard de Semaforo para Proveedor
9. Pagina de Reporte para Proveedor (exportable)

### Fase 4: Logistica
10. Gestion de Ventanas de Recepcion
11. Ajuste Dinamico (pedidos extraordinarios)

### Fase 5: Entregas Directas
12. Modulo de Bodega Virtual / Drop-Ship
13. Alertas de desvio de ruta

### Fase 6: Automatizacion (requiere infraestructura adicional)
14. Odoo live sync service
15. Cron job para reporte matutino
16. Notificaciones (email/WhatsApp)

---

## NOTAS TECNICAS

- Todos los calculos de inventario neto usaran `effective_date` y `delivered_qty` como SSOT (ya corregido en migracion `20260323000001_fix_demand_ssot.sql`)
- Los montos seran en GTQ (Quetzales) con soporte de tipo de cambio USD ya existente en `exchange_rates`
- El Prophet ML existente se reutilizara para las proyecciones de demanda (no reinventar la rueda)
- Las tablas `purchase_schedule_runs` y `purchase_schedule_lines` existentes del POC pueden evolucionar o coexistir con el nuevo modulo
- **Volumetria**: Toda la logistica se calculara en m3 (no peso). Esto alinea con los datos disponibles (74.6% de productos tienen volume, 95.3% de pickings tienen amount_volume) y con la practica operativa confirmada por el cliente
- **Odoo como SSOT**: La app debe tratar a Odoo como fuente de verdad para inventory, orders, y pickings. Supabase es la capa de procesamiento y presentacion
- **Hilos paralelos** (como dice el spec): El algoritmo debe mantener separados Hilo A (Bodega Central: forecast + buffer) y Hilo B (Bodega Virtual: pedido firme back-to-back, sin buffer)

---

## RELACION CON DOCUMENTOS EXISTENTES

| Documento | Relacion |
|-----------|----------|
| `_ODOO_EXPLORATION_PLAN.md` | Phase 3 (Odoo client) es prerequisito para sync live |
| `_ODOO_EXPLORATION_RESULTS.md` | Confirma datos disponibles y gaps. Informa decisiones de este plan |
| POC Programacion (`/poc/programacion`) | Precursor del modulo OA. Logica de 2-week max inventory evoluciona a 1-week buffer |
| Backtest Engine (`ml/backtest_engine.py`) | Prophet forecast se reutiliza para proyecciones de demanda en OA |
