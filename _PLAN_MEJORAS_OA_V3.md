# Plan de Mejoras: Modulo OA v3 — Estado Actual y Proximos Pasos

**Fuente**: Especificaciones.pdf, _Respuestas.pdf, _MedidasBodegas2025.pdf, _ODOO_EXPLORATION_RESULTS.md, sync results
**Fecha**: 2026-03-30
**Supersede**: _PLAN_MEJORAS_OA_V2.md (marked stale)

---

## Estado Actual del Sistema

### Lo que YA esta implementado y funcionando

#### Modulo OA v1 (2026-03-26)
- **9 tablas**: open_orders, open_order_lines, dispatch_plan_weeks, warehouse_config, unloading_times, reception_schedule, weekly_audits, extraordinary_orders, extraordinary_order_lines
- **7 RPC functions**: net_inventory, hot_list, hold_list, compliance, global_compliance, reception_saturation, supplier_semaphore
- **7 API routes**: /api/oa/{exceptions, net-inventory, compliance, supplier-semaphore, reception, open-orders, warehouse-config}
- **6 paginas**: excepciones, dashboard-proveedor, plan-maestro, cumplimiento, recepcion, configuracion
- **Sidebar**: Seccion "Ordenes Abiertas" con CAN_VIEW_OA
- **RBAC**: superuser, admin, gerencia, compras, inventario, financiero

#### Modulo OA v2 (2026-03-30)
- **Schema extensions**: products.volume_m3, products.is_export, products.supplier_origin, reception_schedule.started_at/completed_at, unloading_times.is_manual_override/calculated_hours/sample_count
- **Warehouse config seeded**: 4 bodegas con datos reales (rampas, horarios 06:00-00:00)
- **Warehouse capacity seeded**: Central 18,785 m3 (exacto del PDF), Zacapa 9,600 m3, Peten 7,200 m3, Zona 11 7,200 m3 (conservadores a 6m altura)
- **Export products classified**: Auto-derivado de product_suppliers — Carvajal (IDs 300, 301, 490, 550) → el_salvador, Reyma (ID 1752) → mexico
- **New RPC functions**: rpc_oa_warehouse_space, rpc_oa_alerts_summary
- **Updated RPCs**: Todos soportan p_warehouse_id, hot/hold list incluyen is_export y cancellable
- **New API routes**: /api/oa/warehouse-space, /api/oa/alerts
- **New page**: /oa/espacio-bodega (dashboard de capacidad por bodega)
- **New component**: OAAlertBanner (banner de alertas al ingresar)
- **Updated pages**: excepciones, dashboard-proveedor, recepcion — todos con selector de bodega y proteccion de exportacion

#### Modulo OA v3 (2026-03-30)
- **Schema**: products.height_m, products.width_m, products.length_m
- **New RPCs**: rpc_oa_detect_extraordinary (EOM projection + deficit + reason classification), rpc_oa_recalc_unload_times (auto-average from completed receptions)
- **New API routes**: /api/oa/extraordinary (GET), /api/oa/recalc-unload (POST)
- **Updated API routes**: /api/oa/reception (POST for discharge tracking), /api/oa/open-orders (GET by ID with lines, PATCH for line management)
- **New pages**: /oa/extraordinarios (deficit detection dashboard), /oa/reporte-proveedor (print-friendly supplier report)
- **Updated pages**: /oa/plan-maestro (detail view with product line add/edit/delete), /oa/recepcion (inline Iniciar/Completar buttons with auto-recalc)
- **Sidebar**: Added "Pedidos Extraordinarios" and "Reporte Proveedor" (total 9 OA nav items)
- **Sync**: 1,139 products updated with height/width/length dimensions from Odoo

#### Sync Odoo → Supabase (2026-03-30)
- **Script**: ml/odoo_sync_oa_v2.py
- **Resultado**: 1,255 productos actualizados con volume_m3, 0 fallos
- **Cobertura de volumen**: 1,281 / 1,653 productos (77.5%)
- **Metodo de match**: Por SKU (default_code → sku), NO por odoo_id
- **Razon**: Los datos en Supabase fueron importados desde produccion Odoo, pero el script lee del test Odoo — IDs diferentes, SKUs iguales

---

## Descubrimientos Clave Durante la Implementacion

### 1. Mismatch de IDs Odoo (Produccion vs Test)

**Hallazgo**: Supabase tiene 1,653 productos importados via CSV desde **produccion Odoo**. El API de sincronizacion conecta al **test Odoo** (suplicentro-2801-27990914.dev.odoo.com). Los database IDs son diferentes entre ambos ambientes.

**Evidencia**:
- Supabase odoo_ids: 1, 87, 88, 100, 101... (secuencia de produccion)
- Test Odoo product.product IDs: 6193, 6443, 6666, 8668, 9154... (secuencia de test)
- Match por odoo_id: solo 366 / 1,653 (22%)
- Match por SKU: 1,281 / 1,653 (77.5%)

**Impacto**: Cualquier sync futuro DEBE usar SKU como clave de match, no odoo_id.

**Implicacion para produccion**: Cuando se conecte al Odoo de produccion, los odoo_ids SI coincidiran. El match por SKU seguira funcionando en ambos casos.

### 2. Datos Dimensionales en Odoo (Stackability)

**Hallazgo**: Odoo tiene campos custom de Studio en product.product:

| Campo | Tipo | Descripcion | Poblacion |
|-------|------|-------------|-----------|
| `x_studio_alto` | float | Alto (Height) | 1,165 productos |
| `x_studio_ancho` | float | Ancho (Width) | No verificado |
| `x_studio_largo` | float | Largo (Length) | No verificado |
| `x_studio_capacidad` | selection | Capacidad | No verificado |
| `x_studio_empaque` | selection | Empaque | No verificado |
| `x_studio_fabricante` | selection | Fabricante | No verificado |
| `weight` | float | Weight (standard) | 2 productos |

**Impacto**: Con Alto/Ancho/Largo por producto, se puede calcular:
- Cuantas unidades caben por nivel en una ubicacion
- Cuantos niveles se pueden apilar (si se conoce la altura maxima del rack/ubicacion)
- Optimizacion de carga de furgones por dimensiones reales

**Estado**: Estos campos NO se importan actualmente a Supabase. Se necesita agregar columnas y sync.

### 3. Cobertura Real de Volumen

| Metrica | Antes del sync | Despues del sync |
|---------|---------------|-----------------|
| Productos con volume_m3 | 201 (12.2%) | **1,281 (77.5%)** |
| Productos sin volume_m3 | 1,452 | **372** |
| Match por odoo_id | 366 | — |
| Match por SKU | — | 1,281 |

De los 372 sin volumen:
- Algunos no existen en el test Odoo (productos solo de produccion)
- Algunos no tienen default_code/SKU en Odoo
- Algunos genuinamente no tienen volumen registrado

### 4. Warehouse 11 — NO es Bodega Virtual para Drop-Ship (confirmado 2026-03-30)

**Hallazgo**: warehouse id=11 se llama "Wal*Mart y Entregas Directas (Furgon cerrado)".

**Confirmacion del cliente**: Esta bodega se usa para **consignacion a Walmart** — el producto se envia a Walmart pero NO se factura en ese momento. Luego se "regresa" logicamente y se factura, porque Walmart no permite facturacion al momento de ingreso del producto.

**Conclusion**: Warehouse 11 es una ubicacion de staging/consignacion con flujo de facturacion especial. **NO es** la bodega virtual para drop-ship directo fabrica→cliente (Hilo B del spec). La bodega virtual para entregas directas aun necesita ser creada en Odoo.

**Implicacion adicional**: El inventario en warehouse 11 esta fisicamente en Walmart pero no esta vendido/facturado. Esto podria requerir tratamiento especial en calculos de inventario — ese stock esta comprometido pero no vendido.

---

## Lo que FALTA por implementar

### Prioridad CRITICA (Bloquea funcionalidad core)

#### A. Sync de datos dimensionales (Alto/Ancho/Largo) — IMPLEMENTADO 2026-03-30
- ~~Agregar columnas `height_m`, `width_m`, `length_m` a tabla `products`~~
- ~~Extender odoo_sync_oa_v2.py para importar x_studio_alto, x_studio_ancho, x_studio_largo~~
- ~~1,165 productos tienen estos datos en Odoo~~
- **Resultado**: Migration `20260330000003` aplicada. Sync ejecutado: 1,139 productos actualizados con dimensiones, 0 fallos.

#### B. Completar volumen de los 372 productos faltantes
- 372 productos no tienen volume_m3
- El sistema los reporta como "productos sin volumen registrado" en la pagina de Espacio en Bodega
- El calculo de espacio ocupado es una subestimacion hasta que se complete
- **Accion del cliente**: Completar product.product.volume en Odoo para los faltantes, luego re-correr sync

### Prioridad ALTA (Mejora precision significativamente)

#### C. Notificaciones push (Email)
- El cliente quiere reportes por email, WhatsApp, y dashboard
- Dashboard: YA IMPLEMENTADO (OAAlertBanner)
- Email: Requiere integracion con servicio (Resend, SendGrid)
- WhatsApp: Requiere WhatsApp Business API (mas complejo)
- **Recomendacion**: Implementar email primero (mas simple, profesional)

#### D. Plan Maestro con lineas de producto — IMPLEMENTADO 2026-03-30
- ~~La pagina /oa/plan-maestro actualmente solo crea el header de la OA~~
- ~~Falta: UI para agregar lineas de producto con forecast_qty por SKU~~
- Falta: Generacion automatica de distribucion S1-S4 usando Prophet forecast
- **Resultado**: Detail view con tabla de lineas, agregar/eliminar lineas por SKU, PATCH API para guardar. Totales se recalculan automaticamente.

#### E. Auto-recalculo de tiempos de descarga — IMPLEMENTADO 2026-03-30
- ~~Los campos started_at/completed_at ya existen en reception_schedule~~
- ~~Falta: UI para registrar inicio/fin de descarga~~
- ~~Falta: Trigger o funcion que recalcule unloading_times.calculated_hours cuando una descarga se completa~~
- **Resultado**: RPC `rpc_oa_recalc_unload_times` creado. API POST `/api/oa/recalc-unload`. Botones "Iniciar"/"Completar" inline en la pagina de recepcion. Al completar, se recalculan promedios automaticamente.

### Prioridad MEDIA (Mejora la experiencia)

#### F. Modulo de Entregas Directas (Drop-Ship)
- Diferido hasta que el cliente cree la bodega virtual en Odoo
- ~~Warehouse 11 ("Wal*Mart y Entregas Directas") podria ser la indicada~~
- **Confirmado 2026-03-30**: Warehouse 11 es consignacion Walmart, NO drop-ship. La bodega virtual para entregas directas fabrica→cliente aun debe crearse en Odoo
- **Nota**: Warehouse 11 tiene un flujo propio (envio sin factura → regreso → facturacion) que podria necesitar su propio modulo en el futuro

#### G. Ajuste Dinamico de Cuota Mensual (Pedidos Extraordinarios) — PARCIALMENTE IMPLEMENTADO 2026-03-30
- ~~La tabla extraordinary_orders existe~~
- ~~Falta: Logica de trigger que detecte cuando proyeccion de cierre < buffer~~
- Falta: UI para aprobar y enviar pedidos extraordinarios al proveedor
- ~~Falta: Reporte de desviacion de forecast (Escenario A/B del spec)~~
- **Resultado**: RPC `rpc_oa_detect_extraordinary` creado — proyecta inventario al cierre de mes, detecta deficit, clasifica razon (demanda > forecast vs retraso proveedor). API GET `/api/oa/extraordinary`. Pagina `/oa/extraordinarios` con KPIs y tabla de deteccion. Falta: flujo de aprobacion y envio.

#### H. Reporte para Proveedor (exportable) — IMPLEMENTADO 2026-03-30
- ~~Pagina para generar PDF/vista compartible con Carvajal/Reyma~~
- ~~Contenido: % cumplimiento + Hot/Hold lists + Lista de Despacho Sugerida~~
- ~~Formato: optimizado para screenshot o PDF~~
- **Resultado**: Pagina `/oa/reporte-proveedor` con selector de proveedor, secciones Hot/Hold/Verde, layout limpio para screenshot, CSS print media query para impresion (oculta sidebar/nav). Falta: generacion de PDF nativo y Lista de Despacho Sugerida con cantidades ajustadas.

---

## Limitaciones Actuales del Sistema

### 1. Sin Odoo Live Sync
Datos importados, no en tiempo real. Inventario, pedidos, y transitos pueden tener horas o dias de retraso.

### 2. Test Odoo vs Produccion Odoo
El sync actual corre contra el **ambiente de pruebas**. Los datos pueden diferir del ambiente de produccion. Cuando se conecte a produccion, el sync por SKU seguira funcionando.

### 3. 22.5% de Productos Sin Volumen
372 de 1,653 productos no tienen volume_m3. El calculo de espacio ocupado subestima la realidad.

### 4. Sin Notificaciones Push
Solo dashboard — no email ni WhatsApp. Los encargados de compra deben entrar al sistema para ver alertas.

### 5. Bodega Virtual No Existe
Confirmado 2026-03-30: Warehouse 11 es consignacion Walmart (no drop-ship). La bodega virtual para entregas directas fabrica→cliente (Hilo B del spec) aun debe crearse en Odoo.

### 6. Sin Data Historica de Tiempos de Descarga
Los campos de Odoo x_studio_inicio_carga y x_studio_terminacin_carga tienen 0% de datos. El auto-recalculo no tiene data para arrancar.

### 7. Capacidades de Bodega Aproximadas (3 de 4)
Solo Bodega Central tiene medidas exactas del PDF (18,785 m3). Zacapa, Peten, y Zona 11 usan estimacion conservadora (6m de altura). Se puede ajustar en /oa/configuracion cuando se tengan medidas exactas.

---

## Recomendaciones para el Cliente (actualizadas)

### RESUELTAS (ya no aplican)

| # Original | Recomendacion | Estado |
|-----------|--------------|--------|
| 4 | Capacidad m3 de cada bodega | **RESUELTO** — PDF proporcionado, seeded en DB |
| 5 | Clasificar productos de exportacion | **RESUELTO** — Auto-derivado de product_suppliers |

### PENDIENTES

| # | Recomendacion | Esfuerzo | Impacto | Urgencia |
|---|--------------|----------|---------|----------|
| 1 | Registrar tiempos de descarga en Odoo (x_studio_inicio_carga / x_studio_terminacin_carga) | 1 min/descarga | ALTO | Empezar hoy |
| 2 | Completar volume (m3) de 372 productos faltantes en Odoo, re-correr sync | 1-2 semanas | ALTO | Esta semana |
| 3 | Asignar vehiculo a despachos en Odoo (x_studio_vehculo) | 1 click/despacho | MEDIO | Empezar hoy |
| 6 | Usar campo de Ruta en despachos (x_studio_ruta_departamentales) | 1 click/despacho | BAJO | Cuando sea posible |
| ~~7~~ | ~~Confirmar si Warehouse 11 es la bodega virtual para drop-ship~~ | — | — | **RESUELTO — NO es drop-ship. Es consignacion Walmart (envio sin factura, regreso y facturacion posterior). La bodega virtual para entregas directas aun debe crearse.** |
| 8 | Proporcionar alturas exactas de bodegas Zacapa, Peten, Zona 11 (actualmente estimadas a 6m) | 5 min | BAJO | Cuando sea posible |

---

## Inventario Completo de Archivos del Modulo OA

### Migrations
| Archivo | Contenido |
|---------|-----------|
| `supabase/migrations/20260326000001_oa_module.sql` | 9 tablas + app_settings |
| `supabase/migrations/20260326000002_oa_rpc_functions.sql` | 7 RPC functions v1 |
| `supabase/migrations/20260330000001_oa_v2_improvements.sql` | Schema extensions + seed data |
| `supabase/migrations/20260330000002_oa_v2_rpc_functions.sql` | Updated RPCs + warehouse_space + alerts_summary |
| `supabase/migrations/20260330000003_oa_v3_dimensions_and_extraordinary.sql` | height/width/length columns + detect_extraordinary + recalc_unload_times RPCs |

### API Routes
| Ruta | Metodo | Funcion |
|------|--------|---------|
| `/api/oa/exceptions` | GET | Hot + Hold lists (supplier_id, warehouse_id) |
| `/api/oa/net-inventory` | GET | Net inventory por producto (supplier_id, warehouse_id) |
| `/api/oa/compliance` | GET | KPIs de cumplimiento (open_order_id) |
| `/api/oa/supplier-semaphore` | GET | Semaforo por producto (supplier_id, warehouse_id) |
| `/api/oa/reception` | GET | Saturacion de recepcion (date, warehouse_id) |
| `/api/oa/open-orders` | GET/POST | CRUD ordenes abiertas |
| `/api/oa/warehouse-config` | GET/POST | Config de bodega + tiempos de descarga |
| `/api/oa/warehouse-space` | GET | Espacio dinamico por bodega (warehouse_id) |
| `/api/oa/alerts` | GET | Resumen de alertas para banner |
| `/api/oa/extraordinary` | GET | Deteccion de pedidos extraordinarios (supplier_id) |
| `/api/oa/recalc-unload` | POST | Recalculo de tiempos de descarga promedio |

### Paginas
| Ruta | Descripcion |
|------|-------------|
| `/oa/excepciones` | Hot List + Hold List con filtros bodega/proveedor |
| `/oa/dashboard-proveedor` | Semaforo Verde/Amarillo/Rojo/Hold |
| `/oa/plan-maestro` | Registro de OA mensual |
| `/oa/cumplimiento` | KPIs de facturacion semanal/global |
| `/oa/espacio-bodega` | Dashboard de capacidad m3 por bodega |
| `/oa/recepcion` | Ventanas de descarga y saturacion de rampa |
| `/oa/extraordinarios` | Deteccion de pedidos extraordinarios con analisis de deficit |
| `/oa/reporte-proveedor` | Reporte compartible/imprimible para Carvajal/Reyma |
| `/oa/configuracion` | Parametros operativos (rampas, horarios, tiempos) |

### Componentes
| Archivo | Descripcion |
|---------|-------------|
| `components/layout/OAAlertBanner.tsx` | Banner de alertas en login |
| `components/layout/FearsSidebar.tsx` | Sidebar con seccion OA (7 items) |

### Scripts
| Archivo | Descripcion |
|---------|-------------|
| `ml/odoo_sync_oa_v2.py` | Sync Odoo → Supabase por SKU (volume_m3) |

### Datos en Odoo Disponibles (no importados aun)
| Campo | Modelo | Poblacion | Descripcion |
|-------|--------|-----------|-------------|
| `x_studio_alto` | product.product | 1,165 | Altura del producto |
| `x_studio_ancho` | product.product | ~1,165 | Ancho del producto |
| `x_studio_largo` | product.product | ~1,165 | Largo del producto |
| `x_studio_empaque` | product.product | ? | Tipo de empaque |
| `x_studio_capacidad` | product.product | ? | Capacidad |
| `x_studio_fabricante` | product.product | ? | Fabricante |
| `x_studio_inicio_carga` | stock.picking | 0% | Hora inicio descarga |
| `x_studio_terminacin_carga` | stock.picking | 0% | Hora fin descarga |
| `x_studio_vehculo` | stock.picking | 0.002% | Vehiculo asignado |
| `x_studio_ruta_departamentales` | stock.picking | 0% | Ruta de despacho |

### Documentos de Referencia
| Archivo | Contenido |
|---------|-----------|
| `_PLAN_ORDENES_ABIERTAS.md` | Plan original OA v1 |
| `_PLAN_MEJORAS_OA_V2.md` | Plan v2 (STALE — superseded by this doc) |
| `_ODOO_EXPLORATION_RESULTS.md` | Hallazgos de exploracion Odoo |
| `Especificaciones.pdf` | Spec original del flujo OA |
| `_Respuestas.pdf` | Respuestas del cliente a preguntas criticas |
| `_MedidasBodegas2025.pdf` | Medidas exactas de 4 galpones Bodega Central |

---

## Datos en Produccion (Supabase)

### warehouse_config
| Bodega | ID | Rampas | Horario | Capacidad m3 | Fuente |
|--------|-----|--------|---------|-------------|--------|
| Central | 1 | 5 | 06:00-00:00 | 18,785.40 | PDF exacto (4 galpones) |
| Zona 11 | 2 | 1 | 06:00-00:00 | 7,200.00 | Estimacion (20x40x2 × 3/4 × 6m) |
| Peten | 3 | 1 | 06:00-00:00 | 7,200.00 | Estimacion (igual a Zona 11) |
| Zacapa | 4 | 1 | 06:00-00:00 | 9,600.00 | Estimacion (20x40x2 × 6m) |

### Productos
| Metrica | Cantidad |
|---------|----------|
| Total productos | 1,653 |
| Con volume_m3 | 1,281 (77.5%) |
| Sin volume_m3 | 372 (22.5%) |
| Con dimensiones (height/width/length) | ~1,139 (68.9%) — synced 2026-03-30 |
| Marcados is_export | ~200+ (Carvajal + Reyma) |
| Con supplier_origin | el_salvador + mexico |

### Proveedores Clave
| Proveedor | IDs | Origen | Export |
|-----------|-----|--------|--------|
| CARVAJAL EMPAQUES CENTROAMERICA | 300 | El Salvador | Si |
| CARVAJAL EMPAQUES, S.A. DE C.V. | 301 | El Salvador | Si |
| Carvajal Empaques, CALI, COLOMBIA | 490 | El Salvador | Si |
| DISTRIBUIDORA CARVAJAL EMPAQUES | 550 | El Salvador | Si |
| REYMA DEL SURESTE, S.A. DE C.V. | 1752 | Mexico | Si |
