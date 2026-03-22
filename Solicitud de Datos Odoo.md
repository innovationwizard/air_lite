# Solicitud de Datos — AI Refill

> **Formato de entrega:** CSV (codificación UTF-8) o Excel (.xlsx)
> **Rango de fechas:** Serie de tiempo completa, hasta un máximo de **24 meses** hacia atrás desde la fecha de exportación.
> **Nombre de archivo sugerido:** `nombre_del_modelo_YYYYMMDD.csv` (ej. `sale_order_20260303.csv`)

---

## Instrucciones Generales

1. Por favor exportar **todos los campos indicados** para cada tabla. Si algún campo no existe, dejarlo vacío o indicarlo en la entrega.
2. Las tablas están organizadas por **nivel de prioridad**. Estoy poniendo primero en la lista las de prioridad más alta para que podamos avanzar con los modelos de predicción mientras se completa el resto.
3. Para tablas con filtro de fecha, exportar únicamente los registros dentro del rango solicitado. Para tablas maestras (sin filtro de fecha), exportar el catálogo completo.
4. **Toda la data recibida será encriptada desde su recepción y almacenada con encripción en reposo en AWS Aurora PostgreSQL**. 

---

## Prioridad 1 — Importancia Crítica

Sin estas tablas no es posible generar ninguna predicción. Son el insumo mínimo para iniciar.

### 1. `sale.order` — Órdenes de Venta

Registros de pedidos de venta. Son la base del motor de pronóstico de demanda.

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `name` | Número de orden |
| `partner_id` | Cliente |
| `date_order` | Fecha de la orden |
| `state` | Estado (draft, sale, done, cancel) |
| `amount_total` | Monto total |
| `amount_untaxed` | Monto sin impuestos |
| `currency_id` | Moneda |
| `warehouse_id` | Bodega |
| `company_id` | Compañía |

**Filtro de fecha:** `date_order` dentro de los últimos 24 meses.

### 2. `sale.order.line` — Líneas de Órdenes de Venta

Detalle por producto de cada orden de venta. Permite el análisis a nivel de SKU.

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `order_id` | Referencia a `sale.order` |
| `product_id` | Producto |
| `product_uom_qty` | Cantidad |
| `product_uom` | Unidad de medida |
| `price_unit` | Precio unitario |
| `price_subtotal` | Subtotal |
| `discount` | Descuento (%) |

### 3. `product.product` — Catálogo de Productos

Catálogo maestro. Sin este no se puede vincular ningún dato transaccional.

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `name` | Nombre |
| `default_code` | Referencia interna / SKU |
| `categ_id` | Categoría |
| `type` | Tipo (product, consu, service) |
| `uom_id` | Unidad de medida |
| `list_price` | Precio de venta |
| `standard_price` | Costo estándar |
| `active` | Activo (sí/no) |
| `barcode` | Código de barras |

**Sin filtro de fecha** — exportar catálogo completo.

### 4. `stock.quant` — Inventario Actual

Cantidades en existencia por ubicación. Es el insumo de las alertas de faltantes.

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `product_id` | Producto |
| `location_id` | Ubicación |
| `quantity` | Cantidad disponible |
| `reserved_quantity` | Cantidad reservada |
| `in_date` | Fecha de entrada |

**Sin filtro de fecha** — exportar estado actual completo.

---

## Prioridad 2 — Importancia Alta

Sin estas tablas, los modelos de proveedores y reabastecimiento no funcionan. La predicción de demanda queda limitada sin el contexto de compras.

### 5. `purchase.order` — Órdenes de Compra

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `name` | Número de orden |
| `partner_id` | Proveedor |
| `date_order` | Fecha de la orden |
| `date_approve` | Fecha de aprobación |
| `date_planned` | Fecha de recepción planeada |
| `state` | Estado |
| `amount_total` | Monto total |
| `currency_id` | Moneda |

**Filtro de fecha:** `date_order` dentro de los últimos 24 meses.

### 6. `purchase.order.line` — Líneas de Órdenes de Compra

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `order_id` | Referencia a `purchase.order` |
| `product_id` | Producto |
| `product_qty` | Cantidad |
| `product_uom` | Unidad de medida |
| `price_unit` | Precio unitario |
| `date_planned` | Fecha planeada de recepción |

### 7. `res.partner` — Proveedores y Clientes

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `name` | Nombre |
| `supplier_rank` | Rango de proveedor (>0 = es proveedor) |
| `customer_rank` | Rango de cliente (>0 = es cliente) |
| `country_id` | País |
| `city` | Ciudad |
| `email` | Correo electrónico |
| `active` | Activo (sí/no) |

**Sin filtro de fecha** — exportar catálogo completo.

### 8. `product.supplierinfo` — Proveedores por Producto

Relación proveedor-producto. Necesaria para el scorecard de proveedores.

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `partner_id` | Proveedor |
| `product_id` | Producto (o template) |
| `product_tmpl_id` | Template de producto |
| `min_qty` | Cantidad mínima |
| `price` | Precio del proveedor |
| `delay` | Tiempo de entrega (días) |
| `currency_id` | Moneda |
| `date_start` | Vigencia desde |
| `date_end` | Vigencia hasta |

### 9. `stock.move` — Movimientos de Inventario

Historial de entradas, salidas y transferencias. Permite calcular rotación y lead times reales.

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `product_id` | Producto |
| `product_uom_qty` | Cantidad |
| `product_uom` | Unidad de medida |
| `location_id` | Ubicación origen |
| `location_dest_id` | Ubicación destino |
| `date` | Fecha del movimiento |
| `state` | Estado |
| `origin` | Documento origen |
| `picking_id` | Referencia a `stock.picking` |

**Filtro de fecha:** `date` dentro de los últimos 24 meses.

---

## Prioridad 3 — Importancia Media

Sin estas tablas, el sistema funciona pero con granularidad reducida. No se puede segmentar por bodega, agrupar por categoría, ni normalizar unidades correctamente.

### 10. `stock.warehouse` — Bodegas

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `name` | Nombre |
| `code` | Código |
| `partner_id` | Dirección |
| `company_id` | Compañía |

**Sin filtro de fecha** — exportar catálogo completo.

### 11. `stock.location` — Ubicaciones de Inventario

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `name` | Nombre |
| `complete_name` | Nombre completo (ruta) |
| `usage` | Tipo (internal, supplier, customer, transit, etc.) |
| `warehouse_id` | Bodega |
| `active` | Activo (sí/no) |

### 12. `stock.picking` — Transferencias / Recepciones

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `name` | Referencia |
| `partner_id` | Contacto |
| `picking_type_id` | Tipo de operación |
| `scheduled_date` | Fecha planeada |
| `date_done` | Fecha real de finalización |
| `state` | Estado |
| `origin` | Documento origen |

**Filtro de fecha:** `scheduled_date` dentro de los últimos 24 meses.

### 13. `product.category` — Categorías de Producto

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `name` | Nombre |
| `complete_name` | Ruta completa |
| `parent_id` | Categoría padre |

### 14. `uom.uom` — Unidades de Medida

Necesaria para normalizar cantidades cuando distintos productos usan distintas unidades.

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `name` | Nombre |
| `category_id` | Categoría de UdM |
| `factor` | Factor de conversión |
| `uom_type` | Tipo (reference, bigger, smaller) |

---

## Prioridad 4 — Importancia Baja

Datos complementarios. Enriquecen los reportes financieros y permiten manejar escenarios multi-moneda o multi-empresa, pero no bloquean ningún motor de Inteligencia Artificial.

### 15. `account.move` — Asientos Contables / Facturas

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `name` | Número |
| `move_type` | Tipo (out_invoice, in_invoice, entry, etc.) |
| `partner_id` | Contacto |
| `invoice_date` | Fecha de factura |
| `amount_total` | Monto total |
| `state` | Estado |
| `currency_id` | Moneda |

**Filtro de fecha:** `invoice_date` dentro de los últimos 24 meses.

### 16. `account.move.line` — Líneas de Asientos Contables

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `move_id` | Referencia a `account.move` |
| `product_id` | Producto |
| `quantity` | Cantidad |
| `price_unit` | Precio unitario |
| `debit` | Débito |
| `credit` | Crédito |
| `account_id` | Cuenta contable |

### 17. `res.currency` — Monedas

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `name` | Código (USD, MXN, etc.) |
| `symbol` | Símbolo |
| `rate` | Tasa actual |

### 18. `res.company` — Compañías

Solo aplica si la instalación de Odoo maneja más de una empresa.

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno |
| `name` | Nombre |
| `currency_id` | Moneda base |
| `country_id` | País |

---

## Resumen de Prioridades

| Prioridad | Tablas | Impacto si falta |
|-----------|--------|-----------------|
| **Prioridad 1 — Importancia Crítica** | sale.order, sale.order.line, product.product, stock.quant | No se puede iniciar ningún motor de predicción |
| **Prioridad 2 — Importancia Alta** | purchase.order, purchase.order.line, res.partner, product.supplierinfo, stock.move | Sin scoring de proveedores ni análisis de reabastecimiento |
| **Prioridad 3 — Importancia Media** | stock.warehouse, stock.location, stock.picking, product.category, uom.uom | Funcionalidad limitada: sin segmentación por bodega ni normalización de unidades |
| **Prioridad 4 — Importancia Baja** | account.move, account.move.line, res.currency, res.company | Sin reportes financieros ni soporte multi-moneda |
