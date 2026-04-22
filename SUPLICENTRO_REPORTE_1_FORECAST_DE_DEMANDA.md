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