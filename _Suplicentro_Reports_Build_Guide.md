# Suplicentro — Guía de Construcción de Reportes desde Odoo

**Cliente:** Suplicentro / Piensom (compañía Odoo: PLASTICENTRO, S.A.)
**Versión Odoo:** 17.0+e (Enterprise)
**URL:** https://suplicentro-2801-27990914.dev.odoo.com
**DB:** suplicentro-2801-27990914
**Usuario:** integracion@piensom.com (UID 182)
**Fecha del documento:** 2026-04-17
**Fuente del diagnóstico:** Transcripción de reunión operativa (`Suplicentro_Reports.txt`) + auditoría previa de acceso Odoo (`_ODOO_EXPLORATION_RESULTS.md`, 2026-03-26)

---

## Cómo leer este documento

Cada reporte tiene la misma estructura:

1. **Qué hacen hoy** — el proceso manual actual, en palabras del cliente.
2. **Qué hay que construir** — el entregable objetivo.
3. **Tablas de Odoo necesarias** — con el estado de acceso (✅ accesible / 🚫 bloqueado) confirmado el 2026-03-26.
4. **Paso a paso** — la lógica para construir el reporte. Escrito para un humano no experto; cada paso indica qué tabla se toca, qué campo se lee, qué cálculo se hace.
5. **Campos exactos** — nombres técnicos de los campos Odoo para que no haya ambigüedad.
6. **Gotchas / Riesgos** — trampas conocidas (vienen de auditorías previas: `ODOO_vs_APP_AUDIT.md`).
7. **Bloqueos** — lo que falta resolver antes de poder construir.

---

## Mapa general de tablas Odoo disponibles

Tablas confirmadas accesibles (auditoría 2026-03-26):

| Modelo Odoo | Qué contiene | Registros |
|---|---|---|
| `product.product` | Variantes de producto (SKU) | 1,628 |
| `product.template` | Plantillas de producto (genérico) | — |
| `product.category` | Categorías de producto | 38 |
| `product.supplierinfo` | Relación proveedor ↔ producto (lead time, precio) | 1,965 |
| `product.packaging` | Empaques (paquete, caja, fardo) | 9 (pobre) |
| `uom.uom` | Unidades de medida | — |
| `sale.order` | Órdenes de venta | 80,011 |
| `sale.order.line` | Líneas de orden de venta | 446,613 |
| `purchase.order` | Órdenes de compra | 3,047 |
| `purchase.order.line` | Líneas de orden de compra | 19,322 |
| `stock.quant` | Inventario actual (en mano) | 9,431 |
| `stock.move` | Movimientos de inventario | 1,028,003 |
| `stock.move.line` | Movimientos detallados por lote/ubicación | 900,485 |
| `stock.picking` | Transferencias (recepciones, despachos, traslados) | 222,230 |
| `stock.picking.type` | Tipos de operación | 118 |
| `stock.warehouse` | Bodegas | 25 |
| `stock.location` | Ubicaciones (internas/virtuales/cliente/proveedor) | 208 |
| `stock.route`, `stock.rule` | Rutas y reglas de abastecimiento | 258 / 530 |
| `res.partner` | Clientes y proveedores | 22,086 |
| `account.move` | Facturas y notas de crédito | 1,352,394 |
| `account.move.line` | Líneas de factura | 5,050,095 |
| `fleet.vehicle` | Flota vehicular | 29 |

Tablas **no accesibles** en el ambiente de prueba:

| Modelo | Impacto |
|---|---|
| `mrp.bom` 🚫 | **Bloquea Reporte #4 (Material de Empaque)** — las recetas (BOM) no se pueden leer. |
| `mrp.bom.line` 🚫 | Líneas de BOM inaccesibles. |
| `mrp.production` 🚫 | Órdenes de producción inaccesibles (menos crítico — Suplicentro terceriza). |
| `stock.package.type` 🚫 | Tipos de empaque con dimensiones inaccesibles. |
| `delivery.carrier` 🚫 | Transportistas inaccesibles. |
| `ir.model` 🚫 | No se puede enumerar el catálogo completo de modelos. |
| `stock.warehouse.orderpoint` | No validado — probablemente accesible pero no se ha confirmado. |

---

## Conceptos transversales (léalos antes de cualquier reporte)

### A. La verdad de ventas: `sale.order.line` vs `account.move.line`

Hay dos fuentes posibles para "ventas":

- **`sale.order.line`** — líneas de pedido. Incluye pedidos en cualquier estado (borrador, confirmado, cancelado). Para contar **sólo ventas confirmadas**, filtrar `sale.order.state IN ('sale','done')`. Esto representa lo **pedido**.
- **`account.move.line`** — líneas de factura. Filtrando `account.move.move_type IN ('out_invoice','out_refund') AND account.move.state = 'posted'` se obtiene la venta **facturada**. Esto es lo realmente cobrado/emitido.

**Regla práctica:** para forecasting y análisis financiero usar `account.move.line` facturada (más fiel). Para análisis operativo (qué se está pidiendo ahora mismo) usar `sale.order.line`. La auditoría previa (`ODOO_vs_APP_AUDIT.md` bug #13) ya demostró que mezclar estados infla las ventas ~5.5%.

### B. Códigos archivados (crítico, Parte 6 de la transcripción)

El cliente reportó: cuando archivan un SKU y crean uno nuevo, pierden el histórico de ventas del viejo. Esto se rompe porque:

- `product.product.active = False` para el código viejo.
- Las consultas por defecto filtran `active = True`.

**Siempre al leer `product.product` usar `search([('active','in',[True,False])])`** o equivalente (el parámetro `context={'active_test': False}`). Si no, se pierde el histórico de todos los archivados.

Además, el cliente hace una unificación manual cambiando el código del archivado al del nuevo. Esto significa que **Odoo no tiene la relación padre-hijo entre códigos archivados y sus reemplazos**. Hay que capturarla en una tabla externa (ver Reporte #5).

### C. Ubicaciones internas vs virtuales

`stock.quant.location_id` apunta a `stock.location`. Para "inventario real físico" filtrar `stock.location.usage = 'internal'`. Los otros valores son:
- `supplier` → ubicación virtual de proveedor (origen de recepciones)
- `customer` → ubicación virtual de cliente (destino de despachos)
- `transit` → tránsito entre bodegas
- `inventory`, `production`, `view` → otros usos

### D. Flujo de una recepción (compras)

```
purchase.order (PO)
   └── purchase.order.line (una línea por producto)
           └── se materializa en uno o más stock.move
                   └── stock.move.state='done' cuando se recibe
                           └── stock.picking (el "envío" físico)
                                   └── stock.move.line (detalle lote/ubicación)
```
Enlaces clave:
- `purchase.order.line.id` ← `stock.move.purchase_line_id`
- `stock.move.picking_id` → `stock.picking.id`

### E. Flujo de un despacho (ventas)

```
sale.order (SO)
   └── sale.order.line
           └── stock.move (reserva y despacho)
                   └── stock.picking (operación de salida)
                           └── stock.move.line (detalle del picking)
```
Enlaces clave:
- `sale.order.id` ← `stock.picking.sale_id` (enlace directo en v17)
- `sale.order.id` ← `stock.move.group_id.sale_id` (vía grupo de procurement)

### F. Cuidado con UOM (Unidad de Medida)

Bug histórico documentado (`ODOO_vs_APP_AUDIT.md` bug #10, #12): mezclar `product_uom_qty` de productos con distinto `uom_id` sin convertir da basura. Para cualquier suma/agregación **convertir todo a la UoM de referencia** del producto:

```
cantidad_normalizada = product_uom_qty * product_uom.factor / reference_uom.factor
```

Odoo guarda el factor en `uom.uom.factor`. El `uom.uom.uom_type` indica si es `reference` (base), `bigger` (múltiplo) o `smaller` (submúltiplo).

### G. Data quality conocida

- `products.cost` tiene corrupción en la cola larga (~714 productos con `cost > precio`). No usar costo para márgenes hasta limpiar. Top 10 productos sí tiene margen correcto (~20%).
- `x_studio_vehculo` poblado en sólo 4 de 196K despachos (0.0%). Asignación de vehículo casi inexistente hoy.
- `x_studio_inicio_carga` / `x_studio_terminacin_carga` prácticamente vacíos (0.0%).

---

# REPORTE 1 — FORECAST DE DEMANDA

## 1.1 Qué hacen hoy

Wilmer (comprador) hace en Excel manual:

- Toma venta histórica últimos 6 meses.
- Identifica temporalidad últimos 3 meses.
- Aplica tendencia de crecimiento mes a mes.
- Proyecta el siguiente mes por código/proveedor.
- Compara con forecast de Ventas (Roberto/comercial).
- Reúnen a revisar diferencias significativas.

Limitaciones actuales:
- **No escalable** (todo manual, Excel).
- **No pueden proyectar más de 3 meses con certeza.**
- Proveedores (especialmente importados: México, El Salvador, Colombia, China) preguntan desde julio por forecast de los siguientes 3 meses y no tienen respuesta sólida.
- Compras locales (5 días lead time) e importadas (90 días lead time) se analizan distinto — quieren unificar.

## 1.2 Qué hay que construir

Proyección mensual de demanda por **SKU × bodega × mes**, capaz de generar:
- Horizonte hasta **6–12 meses** (no sólo 3).
- Ajuste por estacionalidad (últimos 3 meses).
- Ajuste por crecimiento tendencial.
- Comparación "forecast del sistema" vs "forecast de ventas" para la reunión.
- Segmentación por **tipo de abastecimiento** (local vs importado) porque el lead time cambia la decisión.

## 1.3 Tablas Odoo necesarias

| Tabla | Para qué | Acceso |
|---|---|---|
| `account.move.line` | Venta histórica facturada (fuente de verdad) | ✅ |
| `account.move` | Cabecera para filtrar `move_type` y `state` | ✅ |
| `sale.order.line` | Alternativa / para pipeline actual | ✅ |
| `sale.order` | Cabecera con fecha, estado, bodega | ✅ |
| `product.product` | Catálogo (incluyendo archivados) | ✅ |
| `product.template` | Plantilla (categoría, tipo) | ✅ |
| `product.category` | Categoría de producto | ✅ |
| `product.supplierinfo` | Proveedor principal + lead time (`delay`) | ✅ |
| `res.partner` | Proveedor (país = local vs importado) | ✅ |
| `stock.warehouse` | Bodega / centro de distribución | ✅ |
| `uom.uom` | Conversión de unidades | ✅ |

## 1.4 Paso a paso

**Paso 1 — Extraer ventas históricas (últimos 24 meses).**

De `account.move.line` filtrando por su `move_id`:
- `account.move.move_type IN ('out_invoice','out_refund')` → sólo facturas de venta y notas de crédito.
- `account.move.state = 'posted'` → sólo confirmadas.
- `account.move.invoice_date >= today - 24 meses`.

Para cada línea extraer: `product_id`, `quantity`, `price_unit`, `price_subtotal`, `account.move.invoice_date`, `account.move.partner_id` (cliente), `account.move.journal_id` (para mapear a bodega si aplica).

**Nota:** las notas de crédito (`out_refund`) restan — tratarlas con cantidad negativa al agregar.

**Paso 2 — Normalizar por unidad de medida.**

Para cada línea, leer `product.product.uom_id` y `uom.uom.factor`. Convertir `quantity` a una unidad de referencia consistente (la UoM de referencia de la categoría de UoM del producto). Ver [Concepto F](#f-cuidado-con-uom-unidad-de-medida).

**Paso 3 — Incluir productos archivados.**

Al hacer el join con `product.product` usar `active IN (True, False)`. Si no, los SKUs archivados aparecen como "sin nombre" y se pierde el histórico. Esto es el [dolor #3 del cliente](#b-códigos-archivados-crítico-parte-6-de-la-transcripción).

Para unificar un código archivado con su reemplazo hay que tener una tabla externa de mapeo (ver Reporte #5). Mientras no exista, el sistema debe reportar los archivados como SKUs separados y **alertar** al analista de que existen archivados con ventas históricas.

**Paso 4 — Agregar por SKU y mes.**

Agrupar por `(product_id, año-mes)` sumando `quantity` normalizada. Resultado: matriz de 24 filas (meses) × N productos.

**Paso 5 — Calcular componentes del forecast.**

Para cada SKU:

1. **Baseline (nivel):** promedio móvil de los últimos 6 meses.
2. **Tendencia:** pendiente de regresión lineal simple sobre los últimos 6 meses. O: `(promedio últimos 3m) / (promedio 3m anteriores) - 1`.
3. **Estacionalidad:** para cada mes del año, calcular el índice estacional como `venta(mes) / promedio(año)` usando 12–24 meses de histórico. Si hay <12 meses, no aplicar estacionalidad.
4. **Proyección mes siguiente:** `baseline × (1 + tendencia) × indice_estacional(mes_objetivo)`.
5. **Proyección 2–12 meses adelante:** repetir la fórmula mes a mes con la tendencia compuesta y el índice estacional del mes correspondiente.

**Paso 6 — Clasificar local vs importado.**

De `product.supplierinfo` tomar el proveedor principal (`sequence` menor o `product_tmpl_id` más reciente). De ese proveedor obtener `res.partner.country_id`:
- Guatemala → "Local".
- El Salvador / México / Colombia / China → "Importado".

Adicionalmente exponer `product.supplierinfo.delay` (lead time en días) para que el usuario vea: "este SKU tiene 90 días de lead time, hay que comprar ahora para cubrir forecast de dentro de 3 meses."

**Paso 7 — Segmentar por bodega / centro de distribución.**

La venta histórica no tiene directamente una bodega en `account.move.line`. Hay dos caminos:

- **Camino A (preferido):** unir cada factura a su sale.order original vía `account.move.invoice_origin` (string con el nombre del SO) o vía `account.move.line.sale_line_ids`. Luego tomar `sale.order.warehouse_id`.
- **Camino B (fallback):** usar `account.move.journal_id` mapeado manualmente a bodega si hay un journal por bodega.

Si ninguno funciona consistentemente, se puede derivar la bodega real desde `stock.move` (despachos): unir `sale.order.line.move_ids` → `stock.move.location_id` → `stock.location.warehouse_id`. Esto es más fiel pero más pesado.

**Paso 8 — Output: tabla de forecast.**

Columnas mínimas del reporte final:

| SKU | Descripción | Categoría | Proveedor principal | Tipo (Local/Importado) | Lead time (días) | Bodega | Venta M-1 | Venta M-2 | ... | Venta M-6 | Forecast M+1 | Forecast M+2 | ... | Forecast M+12 | Índice estacional aplicado |

**Paso 9 — Comparación con forecast de Ventas.**

El forecast de Roberto/Ventas hoy viene de un Excel externo. Hay que:
- Tener una interfaz para que Ventas suba su forecast mensual por SKU.
- Calcular la variación `%` entre forecast del sistema y forecast de Ventas.
- Marcar en la UI los SKUs con variación > X% (ej. 20%) para la reunión de forecast.

## 1.5 Campos exactos

```
account.move: id, name, move_type, state, invoice_date, partner_id, journal_id, invoice_origin
account.move.line: id, move_id, product_id, quantity, price_unit, price_subtotal, sale_line_ids
sale.order: id, name, date_order, state, warehouse_id, partner_id
sale.order.line: id, order_id, product_id, product_uom_qty, product_uom, price_subtotal
product.product: id, name, default_code, product_tmpl_id, uom_id, active, categ_id
product.template: id, name, categ_id, type, active
product.supplierinfo: id, partner_id, product_id, product_tmpl_id, delay, min_qty, price, sequence
res.partner: id, name, country_id, supplier_rank
stock.warehouse: id, name, code
uom.uom: id, name, category_id, factor, uom_type
```

## 1.6 Gotchas

- **Bug histórico #12:** `products.cost` mal poblado. No usar costo para margen en el forecast — usar sólo unidades e ingreso. Si se necesita valorización, usar `price_subtotal` (ingreso real), no `qty × cost`.
- **Bug histórico #13:** siempre filtrar estado. Para facturas `state='posted'`, para ventas `state IN ('sale','done')`. Nunca incluir `draft` o `cancel`.
- **Bug histórico #10:** normalizar UoM antes de sumar. Nunca sumar `product_uom_qty` de líneas con distinto `product_uom`.
- **Ventana de 24 meses:** aunque tengan más, el catálogo de SKUs rota; forecasts con datos >24m son poco confiables en este negocio.

## 1.7 Bloqueos

Ninguno. Todas las tablas necesarias están accesibles.

---

# REPORTE 2 — CUMPLIMIENTO DE PROVEEDORES

## 2.1 Qué hacen hoy

Hoy el reporte de cumplimiento se construye a mano en **16 pasos** (Parte 9 de la transcripción):

- Entran a cada orden de compra en Odoo.
- Ven que se cumplió "el 90% de la orden" en cantidad, pero **no saben si llegó a tiempo**.
- Una sola OC puede tener 10 entregas parciales en fechas distintas; cada una hay que cruzar manualmente.
- Descargan las OCs, las cruzan con fechas reales de ingreso, calculan % de cumplimiento, arman el reporte por proveedor.

## 2.2 Qué hay que construir

Scorecard por proveedor con:
- **% cumplimiento en cantidad** (recibido vs pedido).
- **% cumplimiento en tiempo** (recibido en fecha planeada vs fuera de fecha).
- **Detalle por entrega** (fecha planeada, fecha real, días de atraso, cantidad planeada, cantidad recibida).
- **Tendencia** últimos 6/12 meses por proveedor.
- Ranking de mejores y peores proveedores.

## 2.3 Tablas Odoo necesarias

| Tabla | Para qué | Acceso |
|---|---|---|
| `purchase.order` | Cabecera de OC | ✅ |
| `purchase.order.line` | Líneas de OC (qty pedida, fecha planeada) | ✅ |
| `stock.move` | Movimientos de recepción (qty real, fecha real) | ✅ |
| `stock.move.line` | Detalle de cada movimiento físico | ✅ |
| `stock.picking` | Recepción (tipo incoming) | ✅ |
| `stock.picking.type` | Para filtrar tipo "incoming" | ✅ |
| `product.product` | Nombre del producto | ✅ |
| `product.supplierinfo` | Lead time esperado (`delay`) | ✅ |
| `res.partner` | Nombre del proveedor | ✅ |

## 2.4 Paso a paso

**Paso 1 — Listar líneas de OC del período.**

De `purchase.order.line` tomar todas donde `purchase.order.state IN ('purchase','done')` y `purchase.order.date_order` en la ventana deseada (ej. últimos 12 meses).

Campos clave por línea: `id`, `product_id`, `product_qty` (cantidad pedida), `product_uom`, `date_planned` (fecha prometida), `price_unit`, `order_id.partner_id` (proveedor), `order_id.name`.

**Paso 2 — Para cada línea de OC, encontrar sus recepciones.**

En `stock.move` filtrar `purchase_line_id = <id de la línea>` y `state = 'done'`. Cada movimiento `done` representa una recepción parcial de esa línea.

Campos clave por movimiento: `product_uom_qty` (cantidad programada), `quantity` (cantidad real recibida, v17), `date` (fecha en que se marcó `done`), `picking_id`.

En Odoo 17 el campo con la cantidad realmente recibida puede ser `quantity` o `quantity_done` según configuración. Validar en vivo: leer un par de registros `done` para confirmar qué campo está poblado. El campo `product_uom_qty` es la cantidad programada de ese move (puede diferir de `purchase.order.line.product_qty` si hubo entregas parciales).

**Paso 3 — Calcular cumplimiento en cantidad por línea.**

```
qty_pedida = purchase.order.line.product_qty
qty_recibida = SUM(stock.move.quantity WHERE purchase_line_id = linea AND state='done')
% cumplimiento cantidad = qty_recibida / qty_pedida
```

Si `% < 1.0` → incumplimiento parcial. Si `% > 1.0` → sobreentrega.

Normalizar UoM: `purchase.order.line.product_uom` puede diferir de `stock.move.product_uom`. Convertir ambos a UoM de referencia del producto antes de dividir.

**Paso 4 — Calcular cumplimiento en tiempo por línea.**

```
fecha_planeada = purchase.order.line.date_planned
fecha_recibida_completa = MAX(stock.move.date) [última recepción que completa la línea]

atraso_dias = fecha_recibida_completa - fecha_planeada
```

Convenciones de "a tiempo":
- `atraso_dias <= 0` → **a tiempo**.
- `0 < atraso_dias <= 3` → **tolerable** (configurable por cliente).
- `atraso_dias > 3` → **tarde**.

**Paso 5 — Agregar por proveedor.**

Agrupar por `purchase.order.partner_id` y calcular:
- % líneas entregadas completas (qty_recibida ≥ qty_pedida × 0.95).
- % líneas a tiempo.
- Atraso promedio (días).
- Atraso máximo.
- # de OCs totales, # de líneas totales.
- Valor en Q de lo pedido vs recibido.

**Paso 6 — Detalle por entrega (drill-down).**

Cuando el usuario hace click en un proveedor, mostrar la lista de OCs con cada línea y cada recepción:

| OC | SKU | Qty pedida | Qty recibida | % | Fecha planeada | Fecha real (última) | Atraso (días) | # entregas parciales |

Para `# entregas parciales` contar `stock.move` distintos con `purchase_line_id = linea AND state='done'`.

**Paso 7 — Vista mensual / tendencia.**

Agrupar el scorecard por `mes(purchase.order.date_order)` para ver evolución: un proveedor puede estar mejorando o empeorando. Graficar como línea.

## 2.5 Campos exactos

```
purchase.order: id, name, partner_id, date_order, date_planned, date_approve, state, amount_total, currency_id
purchase.order.line: id, order_id, product_id, product_qty, qty_received, product_uom, date_planned, price_unit
stock.move: id, purchase_line_id, product_id, product_uom_qty, quantity, state, date, picking_id, product_uom
stock.move.line: id, move_id, product_id, quantity, date, location_dest_id
stock.picking: id, name, partner_id, picking_type_id, state, scheduled_date, date_done
stock.picking.type: id, name, code  (code='incoming' para recepciones)
product.supplierinfo: id, partner_id, product_tmpl_id, delay, min_qty
```

**Atajo importante:** `purchase.order.line.qty_received` ya existe en Odoo como campo calculado. Si está disponible y confiable, evita tener que agregar `stock.move` manualmente. **Validar primero con unos registros** que coincide con el agregado manual antes de confiar.

## 2.6 Gotchas

- **Una línea puede tener múltiples `stock.move`** — cada entrega parcial genera un move distinto. Siempre sumar, nunca tomar uno solo.
- **Odoo permite cerrar una OC como "done" aunque no se recibió todo.** No asumir que `state='done'` significa cumplimiento total.
- **Devoluciones** generan `stock.move` con dirección inversa (`location_id` interno → `location_dest_id` = supplier). Filtrar sólo los de recepción: `location_id` usage='supplier' → `location_dest_id` usage='internal'.
- **Cambios de fecha planeada:** Odoo permite modificar `date_planned` después de emitida la OC. El campo refleja la fecha actual, no necesariamente la original. Si hay auditoría necesaria, habría que leer `mail.message` / tracking, que no está validado como accesible.
- **Sobreentrega:** contar como "cumplido" pero marcar como anomalía (puede saturar bodega).

## 2.7 Bloqueos

Ninguno. Todo accesible.

---

# REPORTE 3 — DASHBOARD DE INVENTARIO EN TIEMPO REAL

## 3.1 Qué hacen hoy

Roberto (gerencia) pregunta hasta dos veces al día: "¿Cómo estamos? ¿Cuántos días de inventario? ¿Qué viene en tránsito?" El sistema no lo da fácil. Hoy se arma a mano: descargar inventario, calcular días, sumar tránsito, revisar cumplimiento a medio mes.

Esperan el cierre de mes (15 días de retraso) para saber cómo les fue. A medio mes no tienen visibilidad.

Quieren verlo desde el celular, estilo dashboard con colores y gráficos simples.

## 3.2 Qué hay que construir

Dashboard web/móvil con:
- **Días de inventario por SKU y por categoría** (on-hand ÷ venta diaria promedio).
- **Inventario en tránsito** (lo comprado en camino, por SKU y por proveedor).
- **Ventas mes a la fecha** vs forecast del mes (a medio mes ya debe verse si van bien o mal).
- **Alertas** de faltantes inminentes.
- Accesible desde celular.

## 3.3 Tablas Odoo necesarias

| Tabla | Para qué | Acceso |
|---|---|---|
| `stock.quant` | Inventario en mano (cantidad, reservado) | ✅ |
| `stock.location` | Filtrar ubicaciones internas | ✅ |
| `stock.warehouse` | Bodega | ✅ |
| `stock.picking` | Para tránsito (pickings no completados) | ✅ |
| `stock.picking.type` | Filtrar `code='incoming'` | ✅ |
| `stock.move` | Movimientos en tránsito detallados | ✅ |
| `purchase.order` | Contexto del tránsito (proveedor, fecha) | ✅ |
| `account.move.line` + `account.move` | Venta mes a la fecha | ✅ |
| `product.product` | Producto | ✅ |
| `uom.uom` | Conversión | ✅ |

## 3.4 Paso a paso

**Paso 1 — Inventario en mano por SKU y bodega.**

```
SELECT product_id, location_id, SUM(quantity - reserved_quantity) AS disponible
FROM stock.quant
WHERE location_id IN (ubicaciones internas)
GROUP BY product_id, location_id
```

Las "ubicaciones internas" son `stock.location.usage = 'internal'`. Cada ubicación pertenece a una bodega: `stock.location.warehouse_id`.

Agregación final por SKU × bodega:

```
disponible_por_sku_bodega = SUM(stock.quant.quantity - stock.quant.reserved_quantity)
  para todas las stock.location de esa bodega donde usage='internal'
```

`quantity` es lo físicamente presente. `reserved_quantity` es lo reservado para pedidos ya confirmados. La diferencia es lo realmente disponible para nuevas ventas.

**Nota:** existen `stock.quant` con `quantity` negativo (backorders). Bug histórico #16 documentó que esto generó valorización negativa (Q-202M). Al sumar usar `GREATEST(quantity, 0)` si el objetivo es valorización; para "disponible real" mantener negativo porque informa de déficit.

**Paso 2 — Inventario en tránsito (lo que viene).**

De `stock.picking`:
- `picking_type_id.code = 'incoming'` (recepciones).
- `state IN ('waiting','confirmed','assigned')` (no está `done` ni `cancel`).

Para cada picking tomar sus `stock.move` con mismo `state`:

```
en_transito(sku, proveedor) = SUM(stock.move.product_uom_qty)
  WHERE picking_id.picking_type_id.code='incoming'
    AND picking_id.state NOT IN ('done','cancel')
    AND stock.move.product_id = sku
```

Enriquecer con proveedor: `stock.picking.partner_id` o `purchase.order.partner_id` vía `stock.picking.origin` (nombre de OC) o mejor: `stock.move.purchase_line_id.order_id.partner_id`.

Campo de fecha esperada: `stock.picking.scheduled_date`.

**Paso 3 — Días de inventario.**

```
venta_diaria_promedio(sku) = venta_últimos_90_días(sku) / 90
dias_inventario(sku) = disponible(sku) / venta_diaria_promedio(sku)
```

La venta diaria promedio viene de `account.move.line` (ver [Concepto A](#a-la-verdad-de-ventas-saleorderline-vs-accountmoveline)) agrupada por producto sobre los últimos 90 días hábiles (descartar fines de semana si la venta del negocio así lo exige).

Categorías de alerta:
- `< 7 días` → crítico (rojo).
- `7–15 días` → bajo (amarillo).
- `15–45 días` → normal (verde).
- `> 45 días` → sobrestock (azul).

Estos umbrales deben ser configurables por categoría de producto y por criticidad (ver [Reporte #6](#reporte-6--clasificación-abc--criticidad)).

**Paso 4 — Venta mes a la fecha vs forecast.**

```
venta_mtd(sku) = SUM(account.move.line.quantity)
  donde move_type='out_invoice' AND state='posted'
  AND invoice_date entre primer día del mes actual y hoy

forecast_mes_actual(sku) = output del Reporte #1 para este mes

progreso_mes = venta_mtd / forecast_mes_actual
dias_transcurridos_mes = hoy - primer día del mes
dias_laborales_mes = ~22
% del mes completado = dias_transcurridos_mes / dias_laborales_mes
```

Semáforo:
- Si `progreso_mes < % del mes completado × 0.8` → va lento (rojo).
- Si entre 0.8 y 1.2 → on track (verde).
- Si `> 1.2` → va rápido (azul, posible sobreventa).

**Paso 5 — Vista gerencial (Roberto).**

KPIs del header:
- Total inventario (Q y # SKUs).
- % SKUs en stockout (días_inventario < 1).
- % SKUs en sobrestock (días_inventario > 60).
- Venta MTD vs forecast MTD (%).
- Inventario en tránsito total (Q).

Luego tabla con top 20 SKUs en riesgo de faltante (menor días de inventario + top ABC).

**Paso 6 — Refresh / latencia.**

El cliente pidió "tiempo real". En la práctica:
- Conexión directa a Odoo (XML-RPC / JSON-RPC) tiene latencia y puede saturar si muchos usuarios consultan.
- Mejor: sync cada 5–15 minutos a una base de datos local (ya está planeado según `project_odoo_connection.md` — "Live sync service to be built on Railway (Python)").
- El dashboard consulta la réplica, no Odoo directamente.

**Paso 7 — Mobile.**

Diseñar el dashboard mobile-first con:
- Cards grandes con colores.
- Números grandes.
- Un solo gráfico por pantalla.
- Filtros tipo dropdown, no inputs de texto.
- Tap en un KPI abre detalle, no hay tabla densa en el landing.

## 3.5 Campos exactos

```
stock.quant: id, product_id, location_id, quantity, reserved_quantity, in_date
stock.location: id, name, complete_name, usage, warehouse_id, active
stock.warehouse: id, name, code
stock.picking: id, name, partner_id, picking_type_id, state, scheduled_date, date_done, origin
stock.picking.type: id, name, code  (code='incoming'/'outgoing'/'internal')
stock.move: id, product_id, product_uom_qty, quantity, state, date, picking_id, purchase_line_id, location_id, location_dest_id
product.product: id, name, default_code, categ_id, uom_id
```

## 3.6 Gotchas

- **No confundir `stock.quant.quantity` (on-hand) con `stock.move` (flujo).** Quant es el "saldo" actual; move es el "asiento" que lo cambió.
- **`reserved_quantity` puede quedar colgada** si un picking no se cancela bien. Periódicamente Odoo la libera, pero puede haber ruido.
- **Múltiples ubicaciones internas por bodega** (ej. "WH/Stock", "WH/Stock/Zona A"). Sumar todas las descendientes de la bodega.
- **Productos tipo `consu` y `service`** no aparecen en `stock.quant`. Filtrar `product.template.type = 'product'` si sólo interesa el inventariable.
- **Ubicaciones virtuales (transit, supplier, customer)** nunca contar como "disponible".

## 3.7 Bloqueos

Ninguno.

---

# REPORTE 4 — MATERIAL DE EMPAQUE (BOM / RECETA)

## 4.1 Qué hacen hoy

Suplicentro **terceriza** toda la fabricación con maquiladores (cuchara, vaso, plato, bandeja — cada uno con distinto proveedor).

Material de empaque (bolsa, film stretch, sticker, caja corrugada): se compra en Suplicentro y se entrega al maquilador.

Hoy:
- En Odoo existe una "receta" (BOM) por producto terminado, pero **el manejo real es manual en Excel**, distinto al resto de compras.
- **Unidades de medida son un laberinto:** se compra por paquete (millar, ciento, 500) pero se consume por unidad. Hay bug en Odoo que cambia la receta cuando se modifica la UoM.
- **No saben cuánto material de empaque hay realmente.** Acumuladas bolsas desde 2021–2022 ya despintándose (~100,000 unidades).
- El proveedor sólo cubre garantía 6 meses → pérdida directa.
- Pasó: un cliente consumía cubiertos todo el mes; el maquilador se quedó sin materia prima a mitad de mes y nadie se dio cuenta hasta que entregó menos.

## 4.2 Qué hay que construir

- **Inventario real de material de empaque** (con UoM correcta y sin duplicados por conversión).
- **Consumo real por producto terminado** (cuánto empaque se usó por cada maquila entregada).
- **Abastecimiento vs consumo** (si se compra más rápido de lo que se consume → sobrestock que caduca).
- **Alertas cuando el maquilador se está quedando sin material** antes de que entregue menos.

## 4.3 Tablas Odoo necesarias

| Tabla | Para qué | Acceso |
|---|---|---|
| **`mrp.bom`** | **Recetas (estructura del producto)** | **🚫 BLOQUEADO** |
| **`mrp.bom.line`** | **Componentes de cada receta** | **🚫 BLOQUEADO** |
| `mrp.production` | Órdenes de producción | 🚫 (menos crítico, terceriza) |
| `product.product` | Productos empaque + terminado | ✅ |
| `product.category` | Categorizar "Material de Empaque" | ✅ |
| `stock.quant` | Inventario de material de empaque | ✅ |
| `stock.move` | Movimientos de entrega al maquilador y recepción de PT | ✅ |
| `stock.picking` | Despachos al maquilador, recepciones de PT | ✅ |
| `purchase.order.line` | Compras de empaque | ✅ |
| `res.partner` | Maquilador (como cliente o como proveedor dual) | ✅ |
| `uom.uom` + `uom.category` | Conversión paquete → unidad | ✅ |

## 4.4 Bloqueo y opciones

**Bloqueo:** Sin `mrp.bom` no se puede leer cuánto empaque corresponde a cuánto producto terminado. La "receta" existe en Odoo pero el usuario `integracion@piensom.com` no tiene permiso de lectura sobre el módulo MRP (confirmado 2026-03-26).

### Opción A — Pedir acceso a `mrp.bom` (recomendada)

Escribir al IT admin de PLASTICENTRO/Suplicentro solicitando permisos de lectura sobre:
- `mrp.bom`
- `mrp.bom.line`

Es el camino directo. Una vez con acceso, el reporte se arma con los pasos de §4.5.

### Opción B — Importar BOMs desde Excel a nuestra base

Dado que hoy el cliente mantiene las recetas en Excel, capturarlas en una tabla propia (`bom` y `bom_line` en nuestro esquema) con:
- `finished_product_id` (FK a producto terminado en Odoo).
- `component_product_id` (FK a empaque).
- `qty_per_unit` (cuántas bolsas por caja, por ejemplo).
- `component_uom` (UoM del componente).

Sync periódico Excel → nuestra tabla. Esto **duplica verdad** y viola Rule 4 si se considera "data falsa", pero **no** si se trata como ingesta de un sistema de registro externo (el Excel es el sistema de registro de facto hoy).

### Opción C — Inferir consumo desde movimientos físicos

Si `stock.move` registra salidas de empaque al maquilador y entradas de PT desde el maquilador, se puede inferir razón de consumo sin BOM:

```
empaque_enviado(empaque, periodo) = SUM(stock.move.product_uom_qty)
  WHERE product_id = empaque
    AND location_dest_id es la ubicación del maquilador
    AND state='done'
    AND date en periodo

pt_recibido(producto_terminado, periodo) = SUM(stock.move.product_uom_qty)
  WHERE product_id = producto_terminado
    AND location_id es la ubicación del maquilador
    AND state='done'
    AND date en periodo

ratio_inferido = empaque_enviado / pt_recibido
```

Esto sólo funciona si:
1. Se creó una `stock.location` por cada maquilador (como ubicación "subcontractor" o similar).
2. Los despachos al maquilador están registrados en Odoo (no sólo en papel).
3. Las recepciones de PT están registradas.

Si el flujo físico **no** se registra en Odoo, esta opción no es viable.

## 4.5 Paso a paso (suponiendo acceso a `mrp.bom`)

**Paso 1 — Identificar productos que son material de empaque.**

Crear o identificar categoría `product.category` con nombre tipo "Material de Empaque" o usar un tag/filtro acordado con el cliente. Filtrar `product.product` por esa categoría.

**Paso 2 — Inventario en mano de empaque.**

Mismo flujo que Reporte #3, Paso 1, pero filtrado a SKUs de empaque. Sumar `stock.quant.quantity` sobre ubicaciones internas.

**Paso 3 — Consumo planeado según BOM.**

De `mrp.bom` y `mrp.bom.line`:

```
Para cada producto terminado PT:
   bom = mrp.bom WHERE product_tmpl_id = PT.product_tmpl_id
   Para cada línea de bom:
       componente = mrp.bom.line.product_id
       qty_por_unidad = mrp.bom.line.product_qty / mrp.bom.product_qty
       uom_componente = mrp.bom.line.product_uom_id
```

Convertir `qty_por_unidad` a UoM de referencia (ver [Concepto F](#f-cuidado-con-uom-unidad-de-medida)).

**Paso 4 — Consumo real.**

Para cada producto terminado entregado por maquilador en un período:

```
unidades_pt = SUM(stock.move.product_uom_qty con location_id del maquilador → location_dest_id interno, state='done')

consumo_teorico_empaque(componente) = unidades_pt × qty_por_unidad_del_componente
```

Luego comparar con el empaque realmente enviado al maquilador en ese período (Opción C de §4.4).

Diferencia = merma, pérdida, o error de conteo. Ubicar anomalías.

**Paso 5 — Stock de empaque por antigüedad (FIFO).**

Bug del cliente: bolsas acumuladas desde 2021–2022 que se despintan. Reporte por antigüedad:

```
Para cada lote/quant de empaque:
   edad = hoy - stock.quant.in_date
   agrupar por bucket: <6m, 6-12m, 12-24m, >24m
```

Marcar en rojo el bucket `>6m` (fuera de garantía del proveedor).

**Paso 6 — Proyección de consumo y abastecimiento.**

Con forecast del Reporte #1 para cada producto terminado y la receta, proyectar cuánto empaque se necesita cada mes. Restar inventario actual + tránsito. Resultado: cuánto hay que comprar de empaque por mes para no quedar cortos ni sobrestockeados.

## 4.6 Campos exactos (cuando haya acceso)

```
mrp.bom: id, product_tmpl_id, product_id, product_qty, product_uom_id, type, active
mrp.bom.line: id, bom_id, product_id, product_qty, product_uom_id, sequence
uom.uom: id, name, category_id, factor, uom_type
uom.category: id, name
product.product: id, name, default_code, categ_id, uom_id, uom_po_id
product.category: id, name, complete_name
```

## 4.7 Gotchas

- **Bug reportado por el cliente:** cambiar la UoM en Odoo cambia la receta. Es decir, si la bom dice "1 bolsa = 1 millar" y alguien cambia la UoM de "millar" a "unidad", Odoo recalcula mal. Este es un problema operativo — la solución es **no modificar** UoMs en productos ya en uso, y si hay que hacerlo, **duplicar el producto** como workaround.
- **UoM `po_id` vs `uom_id`:** `product.product.uom_po_id` es la UoM de compra (paquete), `uom_id` es la UoM de stock (unidad). Siempre que se calcule consumo, convertir a `uom_id`.
- **Material de empaque puede tener vida útil** (garantía del proveedor 6 meses). Trackear edad del stock es tan importante como la cantidad.
- **BOMs pueden tener variantes** (ej. bandeja roja vs azul usa misma bolsa pero distinto sticker). Revisar que el reporte agregue/desagregue por variante según necesidad.

## 4.8 Bloqueos

**Bloqueante:** Sin acceso a `mrp.bom` el reporte no se puede construir con los datos Odoo. Tres caminos (ordenados por preferencia):

1. **Pedir acceso `mrp.bom`, `mrp.bom.line`** al admin Odoo — camino directo.
2. **Importar las recetas Excel** a tabla propia — viable pero exige sync continuo.
3. **Inferir consumo por ratios de flujo físico** — solo si los movimientos al maquilador están registrados en Odoo (verificar).

---

# REPORTE 5 — MAPA DE HOMÓLOGOS / SUSTITUTOS

## 5.1 Qué hacen hoy

(Parte 11 de la transcripción.) Ejemplo concreto: vaso de cartón 8/11 oz tenía 8 códigos sustitutos. Estaban comprando sólo uno y el otro no, pero podían cambiar y no se sabía. La información **"está sólo en la mente de una persona"** — ningún lugar del sistema los tiene mapeados.

Regla del negocio: un código debe ser **padre** y los otros **hijos** (sustitutos). No se deben comprar los dos al mismo tiempo porque uno tarda 2 meses.

## 5.2 Qué hay que construir

- Estructura de grupos de sustitutos: un producto padre y N hijos homólogos.
- Por grupo: regla de compra (ej. "comprar sólo padre a menos que padre tenga lead time > 60 días").
- Visible al momento de decidir compra (Reporte #1 y #7).

## 5.3 Tablas Odoo necesarias

| Tabla | Para qué | Acceso |
|---|---|---|
| `product.template` | Campo `optional_product_ids` (m2m de productos alternativos) en algunas versiones | ✅ |
| `product.product` | SKUs | ✅ |

**Realidad:** En Odoo 17 `product.template` no tiene un campo nativo robusto de "sustitutos". Existe `optional_product_ids` (para ventas cruzadas) y `accessory_product_ids` pero **ninguno captura la regla de negocio** del cliente (mutual exclusion entre SKUs intercambiables de distintos proveedores).

**Por eso este reporte requiere primero capturar el dato, después reportarlo.**

## 5.4 Opciones de captura

### Opción A — Campo custom en Odoo vía Studio

Crear con Odoo Studio:
- `x_studio_sku_padre` (many2one → `product.product`) en `product.product`. Si `x_studio_sku_padre` está vacío, este SKU es padre (o independiente). Si está lleno, este SKU es hijo de ese padre.
- `x_studio_grupo_sustituto` (char o many2one a un modelo custom) para nombrar el grupo.
- `x_studio_prioridad_sustituto` (integer) para ordenar: padre=1, sustituto preferido=2, etc.

Ventaja: la verdad vive en Odoo, todos lo ven.
Desventaja: el cliente ya expresó dolor con Odoo; cada cambio requiere un administrador.

### Opción B — Tabla propia en nuestra base

```
product_substitute_group
  id, name, created_at, updated_at
product_substitute_member
  id, group_id, product_id (odoo_id), priority (int), role ('parent'|'child'), notes
```

Sync: UI en nuestra app para que Wilmer capture los grupos. No depende de Odoo.

**Recomendación:** Opción B para arrancar (no bloquea por permisos Odoo), con opción de empujar de regreso a Odoo vía `x_studio_*` más adelante.

## 5.5 Paso a paso del reporte (asumiendo datos capturados)

**Paso 1 — Para cada grupo, listar padre + hijos.**

Consulta simple a la tabla propia. Cada fila del reporte es un SKU con su padre y su rol.

**Paso 2 — Enriquecer con datos vivos de Odoo.**

Para cada SKU del grupo, traer de Odoo:
- Inventario actual (Reporte #3, Paso 1).
- Tránsito (Reporte #3, Paso 2).
- Lead time (`product.supplierinfo.delay`).
- Proveedor principal.
- Venta últimos 3 meses (normalizada).

**Paso 3 — Calcular estado del grupo.**

```
demanda_grupo_3m = SUM(venta_últimos_3m de todos los miembros del grupo)
inventario_grupo = SUM(on_hand + transito de todos los miembros)
dias_cobertura_grupo = inventario_grupo / (demanda_grupo_3m / 90)
```

La lógica es: el cliente no consume el padre y el hijo por separado, los consume intercambiable — así que la cobertura tiene que calcularse **sumando** todo el grupo.

**Paso 4 — Regla de compra recomendada.**

```
SI padre tiene lead_time razonable (< X días) Y stock_del_grupo > umbral:
   comprar sólo padre
SINO SI padre lead_time alto Y uno de los hijos tiene lead_time corto:
   sugerir cambiar a hijo mientras padre llega
SINO:
   alertar al comprador humano
```

**Paso 5 — Visualización.**

Tabla jerárquica: padre expandible a sus hijos. Totales del grupo arriba. Datos individuales abajo. Indicador de cuál se está comprando actualmente (comparar con OCs abiertas).

## 5.6 Gotchas

- **Un sustituto puede romper BOM:** si el SKU está en una receta (Reporte #4), sustituirlo exige revisar que la receta soporte al hijo. Relación con mrp.bom.
- **Un sustituto puede tener distinta UoM:** si el padre se vende en "unidad" y el hijo en "paquete de 25", las sumas quedan mal. Siempre convertir UoM antes de sumar `demanda_grupo`.
- **Sustitutos parciales:** puede que el hijo cubra 80% de los usos del padre pero no el 100% (ej. un cliente institucional exige el padre específico). Registrar `notes` por grupo capturando estas restricciones.
- **Ciclos / multi-padre:** validar en captura que un SKU no sea hijo de dos padres ni padre y hijo al mismo tiempo.

## 5.7 Bloqueos

No hay bloqueo técnico en Odoo. El bloqueo es **captura de datos**: hoy no existen los grupos en ningún sistema. Primer entregable debe ser la interfaz de captura.

---

# REPORTE 6 — CLASIFICACIÓN ABC / CRITICIDAD

## 6.1 Qué hacen hoy

(Parte 12.) No existe clasificación de criticidad en Odoo. Manejan "en la mente" de la persona y "parcialmente en Excel" cuáles códigos son **never be out** — típicamente SKUs para clientes institucionales (Walmart, La Despensa) donde faltar significa que el cliente cambia de proveedor **permanentemente**.

No hay marcador de alta/media/baja en el sistema, no hay frecuencia de reabastecimiento diferenciada, no hay inventario de seguridad por criticidad.

## 6.2 Qué hay que construir

- **ABC por ingresos** (80/15/5 clásico): 80% del ingreso viene del ~20% de SKUs (A), siguiente 15% (B), último 5% (C).
- **ABC por unidades** (volumen de stock): relevante para bodega.
- **Flag "Never Be Out"** aplicable a SKUs de clientes institucionales.
- **Frecuencia de reabastecimiento recomendada** por clase (A=semanal, B=quincenal, C=mensual, ajustable).
- **Safety stock recomendado** por clase y criticidad.

## 6.3 Tablas Odoo necesarias

| Tabla | Para qué | Acceso |
|---|---|---|
| `account.move.line` + `account.move` | Ingreso por SKU | ✅ |
| `sale.order.line` | Alternativa / pipeline | ✅ |
| `product.product` | SKU | ✅ |
| `res.partner` | Para identificar clientes institucionales | ✅ |
| `product.template` | Para guardar flag en custom field | ✅ |
| `stock.warehouse.orderpoint` | Reglas de reabasto (min/max) | ❓ no validado |

## 6.4 Paso a paso

**Paso 1 — Calcular ingreso anual por SKU.**

```
ingreso_sku = SUM(account.move.line.price_subtotal)
  WHERE move_type IN ('out_invoice','out_refund')
    AND state='posted'
    AND invoice_date en últimos 12 meses
  GROUP BY product_id
```

Ordenar descendente.

**Paso 2 — Aplicar clasificación ABC.**

```
total_ingreso = SUM(ingreso_sku)
acumulado = 0
Para cada SKU en orden descendente:
   acumulado += ingreso_sku
   % acumulado = acumulado / total_ingreso
   SI % acumulado <= 0.80 → clase A
   SINO SI % acumulado <= 0.95 → clase B
   SINO → clase C
```

Los umbrales 0.80 / 0.95 son los clásicos Pareto. Ajustar según contexto del negocio (algunos usan 0.70 / 0.90).

**Paso 3 — ABC por unidades (paralela).**

Repetir Paso 2 sobre `SUM(account.move.line.quantity)` (normalizando UoM, ver Concepto F). Esto da una clase distinta para bodega — un SKU puede ser C en ingreso pero A en volumen físico (ocupa espacio pero no aporta Q).

Reporte presenta **ambas clasificaciones** lado a lado.

**Paso 4 — Identificar clientes institucionales.**

`res.partner` no tiene flag "institucional" nativo. Opciones:

- **Opción A:** filtrar por `res.partner.category_id` (etiquetas) si ya hay una categoría "Institucional". Validar con el cliente si existe.
- **Opción B:** usar lista explícita (Walmart, La Despensa, etc.) mapeada por `res.partner.name` o `vat`. Pedirla al cliente.
- **Opción C:** crear campo custom `x_studio_es_institucional` (boolean) en `res.partner`.

**Paso 5 — Calcular % ventas institucionales por SKU.**

```
venta_institucional(sku) = SUM(account.move.line.quantity)
  WHERE product_id = sku
    AND move.partner_id en clientes institucionales
    AND [filtros de estado y fecha iguales al Paso 1]

% institucional = venta_institucional / venta_total
```

**Paso 6 — Flag "Never Be Out".**

Regla recomendada (discutir con cliente):

```
es_never_be_out = 
   clase_A O 
   (% institucional > 30% AND clase_A_o_B) O
   flag_manual
```

El flag manual permite al comprador marcar SKUs a mano que la regla no capturó.

**Almacenamiento del flag:** campo custom en `product.template` vía Odoo Studio (`x_studio_never_be_out` boolean) o en tabla propia sincronizada. Preferencia: Odoo (todos lo ven en la ficha del producto).

**Paso 7 — Recomendar safety stock y frecuencia.**

```
Si never_be_out:
    safety_stock_dias = 30  (configurable)
    frecuencia = 'semanal'
Si clase A:
    safety_stock_dias = 15
    frecuencia = 'semanal'
Si clase B:
    safety_stock_dias = 10
    frecuencia = 'quincenal'
Si clase C:
    safety_stock_dias = 5
    frecuencia = 'mensual'
```

Traducir safety_stock_dias a unidades usando la venta diaria promedio (Reporte #3, Paso 3).

Si `stock.warehouse.orderpoint` está accesible, se puede escribir `product_min_qty` y `product_max_qty` para que Odoo mismo genere órdenes de reabasto automáticas. Validar acceso primero.

**Paso 8 — Reporte final.**

| SKU | Descripción | Ingreso 12m | % acumulado | Clase ingreso | Clase volumen | % institucional | Never Be Out | Stock actual | Días inventario | Safety stock recomendado (días) | Safety stock recomendado (unidades) | Frecuencia recomendada |

## 6.5 Gotchas

- **SKUs nuevos (< 6 meses de vida):** la clasificación ABC sobre 12 meses los penaliza. Segmentar: ABC para SKUs con ≥6 meses, los nuevos clasificarlos aparte como "En Evaluación".
- **Estacionalidad:** un SKU que se vende fuerte 3 meses al año puede quedar C en ingreso anual pero es A durante su temporada. Agregar vista por trimestre.
- **SKUs archivados:** pueden tener ingreso histórico relevante. Incluirlos pero con flag "archivado".
- **Bug histórico #12 `products.cost`:** irrelevante aquí (no usamos costo), pero si el reporte se extiende a márgenes sí aplica.

## 6.6 Bloqueos

Ninguno técnico. Bloqueo de **datos**: hay que decidir cómo se captura "cliente institucional" (Paso 4) — probablemente requiere input del cliente.

---

# REPORTE 7 — FRECUENCIA DE VENTA vs FRECUENCIA DE ABASTECIMIENTO

## 7.1 Qué hacen hoy

(Parte 8.) Ejemplo concreto: contenedor China/Colombia trae inventario de 1.5–2 meses. Antes de terminar llegan otros 7 contenedores. Pero de 2 códigos que se acaban en 2 semanas, toca esperar otro 1.5 meses a ver si el siguiente contenedor los trae — y a veces no.

"Venden 125 unidades en el mes, compran 125, llega el producto el 2 del mes, pero se vende el 30 del mes — no coincidió." Los top 7 códigos **nunca han logrado** tener inventario de seguridad.

El problema: la frecuencia de abastecimiento **no coincide** con la frecuencia de venta. No pueden predecir qué día se necesita cada SKU.

## 7.2 Qué hay que construir

- **Distribución de ventas por día de semana / día del mes** para cada SKU.
- **Distribución de recepciones por día / frecuencia de OC**.
- **Gap entre recepción y consumo** ("el producto llegó, pero ¿cuántos días pasan antes de que se venda?").
- **Recomendación de calendario de compras** para alinear llegadas con consumo real.

## 7.3 Tablas Odoo necesarias

| Tabla | Para qué | Acceso |
|---|---|---|
| `account.move.line` / `sale.order.line` | Venta diaria | ✅ |
| `account.move` / `sale.order` | Fecha | ✅ |
| `stock.move` | Recepciones (entradas a internal) | ✅ |
| `stock.picking` | Fecha real de recepción | ✅ |
| `purchase.order.line` | Cuándo se pidió | ✅ |
| `product.supplierinfo` | Lead time esperado | ✅ |
| `product.product` | SKU | ✅ |

## 7.4 Paso a paso

**Paso 1 — Serie de ventas diarias por SKU (últimos 12–24 meses).**

```
venta_diaria[sku][fecha] = SUM(quantity_normalizada) de las líneas de venta de ese día
```

Desde `account.move.line` (facturado) o `sale.order.line` (pedido). Elegir según alineación con la realidad operativa. Para este reporte recomiendo `sale.order.line` con `state IN ('sale','done')` porque refleja cuándo el cliente **pidió**, que es lo que dispara la necesidad de tener stock.

**Paso 2 — Estadísticas de frecuencia de venta.**

Para cada SKU calcular:

```
dias_con_venta_ultimos_90 = COUNT(fecha WHERE venta_diaria > 0)
frecuencia_venta = dias_con_venta / 90       (ej. 0.45 = vende 45% de los días)

intervalo_promedio_venta = 90 / dias_con_venta_ultimos_90  (días entre ventas)

desv_std_intervalo = STD(diferencias entre fechas de venta consecutivas)
```

También:
- **Venta por día de semana** (lunes, martes, ...): `AVG(venta_diaria)` agrupado por día de semana.
- **Venta por día del mes** (1–31): `AVG(venta_diaria)` agrupado por día del mes.
- **Coeficiente de variación** = desv_std / promedio. Alto = errático. Bajo = estable.

**Paso 3 — Serie de recepciones por SKU.**

De `stock.move`:
```
recepcion_diaria[sku][fecha] = SUM(stock.move.product_uom_qty normalizada)
  WHERE location_id.usage='supplier'
    AND location_dest_id.usage='internal'
    AND state='done'
    AND date (fecha) en últimos 12m
```

Alternativamente unir por `purchase_line_id` si se quiere filtrar sólo recepciones de OCs (excluyendo traslados entre bodegas).

**Paso 4 — Estadísticas de frecuencia de abastecimiento.**

```
dias_con_recepcion_365 = COUNT(fecha con recepción > 0)
frecuencia_abasto = dias_con_recepcion_365 / 365
intervalo_promedio_abasto = 365 / dias_con_recepcion_365   (días entre recepciones)
```

**Paso 5 — Gap de alineación.**

Tres métricas clave para presentar al cliente:

```
ratio_intervalos = intervalo_abasto / intervalo_venta
```
- Si `> 1.5` → se abastece mucho menos frecuente que la venta → riesgo de faltantes.
- Si `< 0.5` → se abastece más frecuente que la venta → sobrestock.

```
dias_stock_despues_de_recepcion[i] = fecha_siguiente_venta - fecha_recepcion[i]
```
Promedio de cuántos días pasa el producto en bodega sin venderse después de llegar. Si es alto para SKUs A, hay oportunidad de reducir capital en bodega.

```
dias_stockout_antes_de_recepcion[i] = fecha_recepcion[i] - fecha_último_stock_cero_previo
```
Si es positivo, hubo stockout. Cuántos días.

**Paso 6 — Detección de patrones semanales / mensuales.**

Para cada SKU con venta estable, detectar patrón. Ejemplos:
- "Vende fuerte lunes y viernes" → ideal recepción domingo/jueves.
- "Vende fuerte 25–30 de cada mes" → ideal recepción ~22.
- "Vende errático" → safety stock dinámico, no patrón.

Usar autocorrelación simple (lag 7 = semanal, lag 30 = mensual) sobre la serie diaria.

**Paso 7 — Recomendación de calendario.**

Para cada SKU:
- Fecha óptima de llegada = fecha pico de venta − lead time − buffer.
- Frecuencia óptima de compra = intervalo_promedio_venta × cobertura_deseada (ej. 1.5x para dejar margen).

Este recomendador es la entrada al Reporte de Plan de Compras (futuro).

**Paso 8 — Output.**

Tabla:

| SKU | Descripción | Intervalo venta (días) | Intervalo abasto (días) | Ratio | Patrón detectado | Días promedio sin venta post-recepción | Días stockout últimos 12m | Lead time proveedor (días) | Fecha óptima próxima recepción |

Adicionalmente un gráfico por SKU (para drilldown): serie diaria de venta (barras) superpuesta con fechas de recepción (marcadores).

## 7.5 Gotchas

- **Traslados entre bodegas** generan `stock.move` entre dos ubicaciones internas. Filtrar sólo `location_id.usage='supplier'` para que no se confundan con abastecimiento.
- **Productos importados con contenedores** tienen patrón de recepción muy discreto (1 o 2 llegadas al mes) que rompe promedios. Tratar estos SKUs aparte (segmento "Importado").
- **Fines de semana y feriados** deben descontarse si el negocio no vende esos días. Mantener un calendario hábil configurable.
- **Lotes/quants agrupados**: una recepción en Odoo puede crear múltiples `stock.move` para el mismo SKU (por lote). Sumar por fecha y producto para obtener recepción única.

## 7.6 Bloqueos

Ninguno.

---

# REPORTE 8 — VISIBILIDAD DE PEDIDOS RESERVADOS

## 8.1 Qué hacen hoy

El cliente no explica proceso detallado en la transcripción, pero sí lista la necesidad: qué tiene reservado cada vendedor/cliente, para cuándo está programado el despacho, y cómo impacta el inventario disponible.

Relacionado: Parte 14 (tema cultural) — los vendedores no saben si hay inventario disponible, llaman a preguntar, hacen pedidos y se enteran después si no hay.

## 8.2 Qué hay que construir

- Lista de pedidos confirmados con cantidad reservada por SKU.
- Fecha programada de despacho.
- Cliente y vendedor asignado.
- Inventario disponible real (on-hand menos reservado por otros pedidos).
- Dashboard por vendedor: sus pedidos pendientes de despachar.

## 8.3 Tablas Odoo necesarias

| Tabla | Para qué | Acceso |
|---|---|---|
| `sale.order` | Pedidos confirmados | ✅ |
| `sale.order.line` | Líneas con producto y cantidad | ✅ |
| `stock.quant` | `reserved_quantity` a nivel ubicación | ✅ |
| `stock.move` | Reservas activas (state='assigned') | ✅ |
| `stock.move.line` | Detalle reservado por lote/ubicación | ✅ |
| `stock.picking` | Despachos programados (outgoing) | ✅ |
| `res.partner` | Cliente | ✅ |
| `res.users` | Vendedor asignado (`sale.order.user_id`) | ✅ (partial) |

## 8.4 Paso a paso

**Paso 1 — Pedidos confirmados no despachados.**

```
sale.order WHERE state='sale' AND invoice_status IN ('to invoice','no') 
   y existe al menos un stock.picking asociado que no está 'done' ni 'cancel'
```

O más simple (menos estricto pero funcional):
```
sale.order WHERE state='sale' AND date_order en últimos 60 días
```

Campos: `id`, `name`, `partner_id`, `user_id` (vendedor), `date_order`, `commitment_date` (fecha comprometida), `warehouse_id`.

**Paso 2 — Líneas del pedido con cantidad reservada.**

De `sale.order.line`:

```
qty_ordenada = product_uom_qty
qty_entregada = qty_delivered  (campo calculado de Odoo)
qty_pendiente = qty_ordenada - qty_entregada
```

**Paso 3 — Detalle de reserva física.**

Para cada línea, encontrar los `stock.move` asociados. En Odoo 17:

```
stock.move WHERE sale_line_id = sale.order.line.id
            AND state IN ('assigned','confirmed','waiting')
```

Campos del move:
- `product_uom_qty` — cantidad programada a mover.
- `quantity` (o `reserved_availability` en versiones previas) — cantidad efectivamente reservada del stock disponible.
- `state`:
   - `'waiting'` — esperando disponibilidad.
   - `'confirmed'` — listo para reservar pero aún no reservado.
   - `'assigned'` — stock reservado físicamente.

Se puede detallar reserva por lote/ubicación con `stock.move.line` (join por `move_id`).

**Paso 4 — Disponibilidad real.**

```
disponible_real(sku) = SUM(stock.quant.quantity - stock.quant.reserved_quantity)
  sobre ubicaciones internas
```

Este es el número que debe ver el vendedor al crear un pedido. No `stock.quant.quantity` a secas.

**Paso 5 — Picking programado.**

Para cada pedido, traer sus `stock.picking` no terminados:

```
stock.picking WHERE sale_id = sale.order.id    (enlace directo en v17)
               AND state IN ('waiting','confirmed','assigned')
               AND picking_type_id.code='outgoing'
```

Campos: `name`, `scheduled_date`, `state`, `location_id` (bodega origen).

También los `x_studio_*` custom ya documentados (`x_studio_vehculo`, `x_studio_zona`, `x_studio_municipio`, `x_studio_vendedor`, `x_studio_total`) — aunque `x_studio_vehculo` está al 0.0% y `x_studio_municipio` al 77.6% (ver `_ODOO_EXPLORATION_RESULTS.md`).

**Paso 6 — Dashboard por vendedor.**

Agrupar por `sale.order.user_id` (si accesible) o por `sale.order.x_studio_vendedor` si el cliente usa el campo custom. Mostrar:

- # pedidos pendientes.
- Q total pendiente de despachar.
- Pedidos con fecha comprometida vencida (alertas rojas).
- Top 10 SKUs con mayor cantidad reservada por ese vendedor.

**Paso 7 — Vista "inventario disponible vs reservado".**

Tabla principal para bodega y ventas:

| SKU | On-hand | Reservado (pedidos activos) | Disponible | Próxima recepción (fecha y cantidad) | Siguiente despacho (fecha y cliente) |

Esto responde la pregunta del vendedor: "¿puedo comprometerme con este pedido?"

## 8.5 Campos exactos

```
sale.order: id, name, partner_id, user_id, date_order, commitment_date, warehouse_id, state, invoice_status
sale.order.line: id, order_id, product_id, product_uom_qty, qty_delivered, price_subtotal, product_uom
stock.move: id, sale_line_id, product_id, product_uom_qty, quantity, state, date, picking_id
stock.move.line: id, move_id, product_id, quantity, location_id, location_dest_id
stock.picking: id, name, sale_id, partner_id, picking_type_id, state, scheduled_date, date_done, x_studio_vehculo, x_studio_zona, x_studio_municipio, x_studio_vendedor
stock.quant: id, product_id, location_id, quantity, reserved_quantity
stock.location: id, usage, warehouse_id
```

## 8.6 Gotchas

- **`qty_delivered` es un campo calculado** en Odoo — depende de pickings done. Puede tener retraso si hay pickings validados pero no refleshed. Validar con casos reales.
- **Reserva "waiting" no consume inventario**: sólo `assigned` (y en cierto modo `confirmed`) descuentan de `reserved_quantity`. No contar waiting como compromiso firme de stock.
- **Orden cancelada con picking aún `confirmed`**: al cancelar la SO, Odoo debería cancelar los pickings, pero si el flujo está mal configurado puede dejar reservas colgadas. Validar con el admin Odoo.
- **Backorders**: cuando un picking se valida parcialmente, Odoo crea un backorder picking. Hay que encadenarlos para ver la cantidad pendiente total.
- **Enlaces SO → picking**: en v17 `stock.picking.sale_id` es el enlace canónico. En versiones anteriores era vía `group_id` / `origin` (string). Usar `sale_id` si disponible.

## 8.7 Bloqueos

Ninguno.

---

# Resumen ejecutivo: qué se puede construir YA y qué requiere acción

| # | Reporte | Se puede construir hoy | Bloqueos / acciones |
|---|---|---|---|
| 1 | Forecast de Demanda | ✅ Sí | Ninguno. Todas las tablas accesibles. |
| 2 | Cumplimiento de Proveedores | ✅ Sí | Ninguno. |
| 3 | Dashboard Inventario en Tiempo Real | ✅ Sí | Ninguno. Requiere sync Odoo → nuestra DB (ya planificado). |
| 4 | Material de Empaque (BOM) | 🚫 No | **Bloqueado**: pedir acceso a `mrp.bom` O importar recetas Excel a tabla propia. |
| 5 | Homólogos/Sustitutos | ⚠️ Parcial | Requiere **captura de datos primero** (tabla propia o campo custom en Odoo). |
| 6 | Clasificación ABC/Criticidad | ✅ Sí | Requiere definir lista de clientes institucionales (input cliente). |
| 7 | Frecuencia Venta vs Abasto | ✅ Sí | Ninguno. |
| 8 | Pedidos Reservados | ✅ Sí | Ninguno. |

## Acciones inmediatas recomendadas

1. **Solicitar al admin Odoo acceso de lectura a `mrp.bom`, `mrp.bom.line`, `mrp.production`.** Desbloquea Reporte #4.
2. **Acordar con el cliente cómo identificar clientes institucionales** (tag en `res.partner` vs lista explícita). Desbloquea Reporte #6, Paso 4.
3. **Validar acceso a `stock.warehouse.orderpoint`** (min/max automático). No está en la lista validada pero probablemente accesible. Refuerza Reporte #6 Paso 7.
4. **Diseñar la UI de captura de grupos de sustitutos** (Reporte #5). Es lo único que hoy vive "en la mente de una persona".
5. **Definir el calendario hábil de Suplicentro** (fines de semana, feriados) — impacta Reportes #1, #3, #7.

## Dudas abiertas que vale confirmar con el cliente antes de construir

- ¿`account.move.line` facturada es la fuente de verdad para "ventas" o prefieren `sale.order.line` pedida? (Recomendación técnica: facturada para forecast, pedida para pipeline.)
- ¿Qué umbral de días_inventario = "crítico"? Hoy sugiero <7, pero ellos pueden tener su propio piso.
- ¿Cómo quieren tratar SKUs con <6 meses de vida en el ABC?
- ¿Está instalado `mrp_subcontracting` (módulo Enterprise para maquila)? Si sí, los flujos de empaque a maquilador están mejor registrados y la Opción C del Reporte #4 es más viable.
- ¿El campo `sale.order.commitment_date` se usa realmente? Si no, la fecha de entrega se captura en otro lado.

---

**Fuentes del documento:**
- `Suplicentro_Reports.txt` — transcripción completa de la reunión.
- `Suplicentro_Reports_Summary.txt` — resumen de reportes necesarios.
- `_ODOO_EXPLORATION_RESULTS.md` — auditoría de acceso Odoo 2026-03-26.
- `ODOO_vs_APP_AUDIT.md` — bugs históricos documentados (v1–v6).
- `Solicitud de Datos Odoo.md` — catálogo de campos por tabla solicitado al cliente.
