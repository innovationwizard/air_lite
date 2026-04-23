# Reconciliación SKU 77201046 — Nov/Dic 2024

**Producto:** VASO DUROPORT No. 10 REYMA 40-25
**SKU:** 77201046
**UdM de venta:** CAJA40 (1 CAJA40 = 40 PAQ CJ)
**Archivos fuente analizados:** `real_data/sale.order_20260303.csv`, `sale.order.line_20260303.csv`, `stock.move_2024.csv`, `uom.uom_20260303.csv`, `account.move.line_2024.csv`
**Snapshot Odoo:** 2026-03-03 22:51:11
**Scripts:** `docs/reconciliation/reconcile_77201046_v{1,2,3,4}.py`

---

## 1. Datos que muestra la App vs SSOT declarado

| Mes | A (ord/ord) | A′ (ord/del) | B (eff/del) | B′ (eff/ord) | **SSOT declarado** |
|---|---:|---:|---:|---:|---:|
| Nov 2024 | 6,851 | 6,706 | **6,361** | 6,360 | **6,466.25** |
| Dic 2024 | 6,653 | 6,296 | **6,301** | 6,384 | **6,496.50** |
| Ene 2025 | 7,644 | 7,479 | 7,160 | 7,179 | — |
| Feb 2025 (ref) | 6,047 | 5,607 | 5,434 | 5,493 | — |

**Diferencia vs SSOT (usando B — la definición declarada como SSOT en `SSOT_VALIDATION.md`):**
- Nov: 6,466.25 − 6,361.00 = **+105.25**
- Dic: 6,496.50 − 6,301.00 = **+195.50**

---

## 2. Verificación de cada definición contra los CSVs de Odoo (snapshot 2026-03-03)

Script: `docs/reconciliation/reconcile_77201046_v1.py`

Las cuatro columnas del tablero **reproducen exactamente** las cifras del CSV cuando se aplica `state IN ('sale','done')`. En la exportación de Odoo `state IN ('sale','done')` se traduce a los estados en español `{'Orden de venta', 'Pedido de venta', 'Bloqueado'}`. En este dataset solo existe `Orden de venta` de ese conjunto, por lo que el filtro se reduce a `state = 'Orden de venta'`.

| Métrica | Filtro exacto | Nov 2024 | Dic 2024 |
|---|---|---:|---:|
| A | `order_date` + `quantity`, state ∈ sale/done | 6,851 | 6,653 |
| A′ | `order_date` + `delivered_qty`, state ∈ sale/done | 6,706 | 6,296 |
| **B (SSOT formal)** | `effective_date` + `delivered_qty`, state ∈ sale/done, `delivered_qty > 0` | **6,361** | **6,301** |
| B′ | `effective_date` + `quantity`, state ∈ sale/done, `delivered_qty > 0` | 6,360 | 6,384 |

Estos números **coinciden** con lo que muestra la app en las columnas A/A′/B/B′. La app no está fabricando valores: está leyendo el mismo snapshot que este script.

### 2.1 Búsqueda exhaustiva (30 combinaciones)

Se probaron todas las combinaciones de `date_basis × qty_col × state_set × del_filter`:

- 2 basis de fecha (`order_date`, `effective_date`)
- 3 columnas de cantidad (`quantity`, `delivered_qty`, `invoiced_qty`)
- 5 sets de estados (`sale_done`, `sale_only`, `done_only`, `not_cancel`, `all`)
- 2 filtros de entrega (`no_filter`, `delivered_qty > 0`)

**Ninguna combinación produce 6,466.25 / 6,496.50 dentro del snapshot de `sale.order.line`.** La más cercana:

| Basis | Cantidad | Estados | Filtro | Nov | Dic | Δ Nov | Δ Dic |
|---|---|---|---|---:|---:|---:|---:|
| effective_date | quantity | sale_done | no_filter | 6,447.00 | 6,609.00 | 19.25 | 112.50 |

---

## 3. Origen probable de los decimales `.25` y `.50`

El producto tiene 3 UdMs en uso en todo el histórico (`sale.order.line`):

| UdM | Ratio Odoo | Significado | Líneas |
|---|---:|---|---:|
| CAJA40 | 0.025 | UdM de venta y stock (referencia física) | 6,035 |
| PAQ CJ | 1.0 | UdM de referencia interna de la categoría "Caja" | 119 |
| Unidad CJ | 1.0 | Equivalente a PAQ CJ | 3 |

Relación: **1 CAJA40 = 40 PAQ CJ**. Normalizar a CAJA40 se hace multiplicando por `0.025`.

Cuando Odoo presenta totales en CAJA40 y una línea se registró en PAQ CJ, `qty / 40` genera decimales. Patrones que explican los decimales observados en SSOT:

- 10 PAQ CJ → 0.250 CAJA40
- 20 PAQ CJ → 0.500 CAJA40

**Conclusión intermedia:** los decimales `.25`/`.50` en el SSOT provienen de una normalización UdM-aware que la app **no está haciendo** en las columnas A/A′/B/B′.

### 3.1 Totales UdM-normalizados a CAJA40 (sale.order.line)

Script: `docs/reconciliation/reconcile_77201046_v3.py`

| Mes | A (norm) | A′ (norm) | B (norm) | B′ (norm) |
|---|---:|---:|---:|---:|
| 2024-11 | 6,819.80 | 6,674.80 | **6,361.00** | 6,360.00 |
| 2024-12 | 6,545.75 | 6,188.75 | **6,301.00** | 6,384.00 |
| 2025-01 | 7,512.375 | 7,347.375 | 7,160.00 | 7,179.00 |
| 2025-02 | 5,992.40 | 5,552.40 | 5,434.00 | 5,493.00 |

**B normalizado no cambia para Nov/Dic 2024** porque **ninguna línea con `effective_date` en esos meses está en PAQ CJ** (todas son CAJA40). Por lo tanto la normalización UdM de `sale.order.line` filtrada por `effective_date + delivered_qty > 0` **no puede** producir 6,466.25 / 6,496.50.

---

## 4. `stock.move` (movimientos reales de inventario) — fuente alterna

Script: `docs/reconciliation/reconcile_77201046_v4.py`

Movimientos con `state = 'Hecho'` (done), SKU 77201046, Nov/Dic 2024, normalizados a CAJA40:

### 4.1 Envíos hacia clientes (`from != Partners/Customers`, `to = Partners/Customers`)

| Mes | Total | Breakdown por bodega origen |
|---|---:|---|
| 2024-11 | **6,568.25** | 1CET 5,962 · 3PET 306 · 4ZAC 210 · T10CN 37.025 · T8TER 37.025 · T7Z11 11.6 · T9LT 4.6 |
| 2024-12 | **6,882.575** | 1CET 5,761 · 3PET 679 · 4ZAC 205 · T10CN 148 · T8TER 59.975 · T7Z11 23.95 · T9LT 5.65 |

### 4.2 Devoluciones de clientes (`from = Partners/Customers`)

| Mes | Total | Breakdown por bodega destino |
|---|---:|---|
| 2024-11 | 157.00 | 1CET 154 · 3PET 3 |
| 2024-12 | 377.10 | 1CET 252 · 3PET 123 · T9LT 2 · T8TER 0.1 |

### 4.3 Neto (envíos − devoluciones)

| Mes | Neto stock.move | SSOT | Δ |
|---|---:|---:|---:|
| 2024-11 | **6,411.25** | 6,466.25 | −55.00 |
| 2024-12 | **6,505.475** | 6,496.50 | +8.975 |

Los decimales cuadran con la forma del SSOT (ambos `stock.move` y SSOT tienen fracciones `.25`/`.50`), pero **las magnitudes no son exactas**.

---

## 5. `account.move.line` — facturas y notas de crédito

El CSV `account.move.line_2024.csv` tiene 1,390 líneas que mencionan 77201046 en todo 2024. Estructura:

- Sin columna de fecha propia en la línea (la fecha vive en el `account.move` padre — `account.move_20260303.csv`)
- Columnas: `Cantidad`, `Precio unitario`, `Débito`, `Crédito`, `Cuenta`, `Cuenta analítica`
- Las notas de crédito (devoluciones) se reconocen por signo/cuenta — no se tuvo acceso a una vista agregada mensual completa en este análisis

**No se reprodujo 6,466.25 / 6,496.50 vía invoice lines** en esta corrida. Requeriría unir con `account.move_20260303.csv` para fechar las líneas y luego sumar por mes — ejercicio pendiente si se confirma que el SSOT proviene de invoicing y no de sales analytics.

---

## 6. Hipótesis ordenadas por probabilidad

### H1 (más probable) — El SSOT viene de Odoo **en vivo** (API/test-env), no del snapshot 2026-03-03

El snapshot está congelado al 2026-03-03. Desde entonces pueden haberse registrado:

- Notas de crédito/devoluciones contabilizadas con fecha contable retroactiva a Nov/Dic 2024
- Correcciones de cantidades
- Facturas refactoradas

La memoria de proyecto `project_odoo_connection.md` indica que existe conexión live a Odoo test env y que hay plan de sincronizar a Railway. Si el SSOT lo obtuvo Luis/David consultando Odoo hoy, y el snapshot de la app es del 2026-03-03, **las cifras no tienen por qué coincidir**.

### H2 — SSOT normaliza UdM + incluye PAQ CJ que están ausentes del snapshot en esos meses

El snapshot no tiene líneas PAQ CJ con `effective_date` en Nov/Dic 2024. Pero si se consulta Odoo hoy y alguna entrega en PAQ CJ se registró **posterior al snapshot** con `effective_date` retroactiva a Nov/Dic 2024, aparecerían decimales `.25`/`.50` exactos.

### H3 — SSOT usa `stock.move` hacia clientes NETO en un universo de bodegas distinto

Neto Nov/Dic = 6,411.25 / 6,505.475 — cerca pero no exacto. Si hay algún filtro adicional (excluir una bodega, incluir ajustes de inventario como "ventas implícitas", etc.), podría calzar. No se encontró el filtro exacto en la búsqueda automatizada.

### H4 — SSOT viene de `account.move.line` (facturación) agregado por fecha de factura, no por `effective_date`

No se verificó en esta corrida por falta de join con fechas contables. Es la siguiente validación pendiente si se descartan H1–H3.

### H5 (menos probable) — Error de captura del SSOT declarado por el usuario

Los decimales `.25`/`.50` son tan consistentes con la conversión PAQ CJ → CAJA40 que parece improbable error tipográfico. Queda como hipótesis residual.

---

## 7. Lo que **está verificado**

- ✅ La app muestra **fielmente** las cuatro definiciones contra el snapshot `sale.order.line_20260303.csv`
- ✅ La definición B (`effective_date` + `delivered_qty`, sale/done, del>0) es exactamente lo que implementa `aggregate_demand_daily()` en `supabase/migrations/20260323000001_fix_demand_ssot.sql`
- ✅ La definición B es la que `SSOT_VALIDATION.md` declara como SSOT
- ✅ Ninguna combinación de filtros sobre `sale.order.line` snapshot produce 6,466.25 / 6,496.50
- ✅ Los decimales del SSOT son compatibles con normalización UdM PAQ CJ → CAJA40
- ✅ `stock.move` produce totales con decimales similares pero magnitudes diferentes

## 8. Lo que **NO está verificado** y requiere información adicional

> Siguiendo Rule 1 de `_THE_RULES.MD` — no asumir. Preguntar.

Para cerrar la reconciliación con certeza necesito saber:

1. **¿De dónde sacaste los valores SSOT 6,466.25 y 6,496.50?**
   - ¿Del UI de Odoo ("Análisis de Ventas" u otra vista)? ¿Qué filtros aplicaste?
   - ¿De la API de Odoo live (no del snapshot 2026-03-03)?
   - ¿De un reporte específico de Luis/David?
2. **¿Esos valores se generaron hoy (2026-04-23) o en una fecha específica?**
3. **¿Hay notas de crédito post-snapshot con `effective_date` retroactivo a Nov/Dic 2024?**
4. **¿El SSOT incluye o excluye movimientos de tienda (T7Z11, T8TER, T9LT, T10CN)?**

Sin estas respuestas **cualquier "corrección" a la app sería una conjetura**, lo cual viola Rule 1 y Rule 4 de `_THE_RULES.MD`.

---

## 9. Acciones propuestas (pendientes de tu visto bueno)

**No ejecutar hasta confirmar el origen del SSOT** — para no arreglar una cifra correcta con un parche equivocado.

- [ ] **A)** Si H1 es correcta: re-ingestar Odoo live (`scripts/ingest.py` contra test env) y re-correr `aggregate_demand_daily()`. La app entonces reflejaría los valores SSOT automáticamente.
- [ ] **B)** Si H2 es correcta: normalizar UdM dentro de `aggregate_demand_daily()` — convertir `sol.delivered_qty` a la UdM de venta del producto antes de sumar. Esto **cambia todos los productos que tienen múltiples UdMs**, no solo 77201046.
- [ ] **C)** Si H3 es correcta: documentar qué conjunto de bodegas/movimientos entra en el SSOT y considerar si la métrica correcta para el demo Gerencia es la de `sale.order.line` (ventas confirmadas) o la de `stock.move` (entregas físicas netas).
- [ ] **D)** Si H4 es correcta: agregar una vista de facturación neta y compararla con la vista de ventas.
- [ ] **E)** Actualizar `SSOT_VALIDATION.md` con la conclusión final y el método definitivo.

---

## 10. Archivos de análisis (persistidos)

- `docs/reconciliation/reconcile_77201046_v1.py` — las 4 definiciones + búsqueda exhaustiva 30 combinaciones
- `docs/reconciliation/reconcile_77201046_v2.py` — desglose por UdM + dump de líneas Nov/Dic
- `docs/reconciliation/reconcile_77201046_v3.py` — totales UdM-normalizados + stock.move por destino
- `docs/reconciliation/reconcile_77201046_v4.py` — stock.move detalle por bodega + account.move.line scan
