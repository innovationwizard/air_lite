# Reconciliation Analytics — SKU 77201046 (Nov/Dic 2024)

**Producto:** VASO DUROPORT No. 10 REYMA 40-25
**SKU:** 77201046
**UoM de venta/stock:** CAJA40
**Conversión clave:** 1 CAJA40 = 40 PAQ CJ
**SSOT declarado por usuario:** Nov 2024 = **6,466.25** | Dic 2024 = **6,496.50**

**Fecha de la corrida:** 2026-04-23

---

## 0. Resumen ejecutivo

| Fuente | Definición B (eff_date + delivered_qty, UoM-norm) | Δ vs SSOT Nov | Δ vs SSOT Dic |
|---|---:|---:|---:|
| A — CSV snapshot 2026-03-03 (`real_data/`) | 6,361.00 / 6,301.00 | **+105.25** | **+195.50** |
| B — Supabase prod DB (`plirrpkasyytpgzwwztl`) | 6,361.00 / 6,301.00 | **+105.25** | **+195.50** |
| C — Odoo live (`suplicentro-2801-27990914.dev.odoo.com`) | 6,366.80 / **6,496.75** | **+99.45** | **−0.25** ✅ |

**Dic 2024 está esencialmente cerrado:** Odoo live = 6,496.75, SSOT = 6,496.50 (diferencia de 0.25 CAJA40 = 10 PAQ CJ — una sola línea).

**Nov 2024 sigue abierto:** Odoo live (hoy) = 6,366.80, SSOT = 6,466.25, gap = 99.45. SSOT Nov NO se reproduce desde Odoo live actual.

### Conclusiones firmes (sobre lo que SÍ pude verificar)

1. **No hay drift entre CSV y prod DB.** Las cifras son idénticas a 4 decimales. La ingesta `scripts/ingest.py` no introdujo discrepancias.
2. **La app está mostrando el dato correcto** según el contrato definido en [SSOT_VALIDATION.md](../../SSOT_VALIDATION.md). `aggregate_demand_daily()` produce 6,361 / 6,301, lo cual es lo que `demand_daily` contiene en prod y lo que `/gerencia/validacion` muestra. Cero bug en la lógica.
3. **Los decimales `.25` y `.50` del SSOT son normalización UoM PAQ CJ → CAJA40** (1 CAJA40 = 40 PAQ CJ; 10 PAQ CJ = 0.25 CAJA40). Esto se confirma porque Odoo live también arroja decimales `.25` / `.75` exactamente con esa misma lógica (factor uom.uom).
4. **Dic 2024 SSOT viene de Odoo live confirmado.** Live = 6,496.75, SSOT = 6,496.50. Una sola línea de 10 PAQ CJ de diferencia. La pregunta es si el SSOT se capturó hace ~24 horas (cuando esa línea aún no existía) o si la regla del SSOT excluye una línea específica.
5. **Snapshot está atrasado:** entre 2026-03-03 (snapshot) y hoy (2026-04-23, 51 días) Odoo live agregó +5.80 CAJA40 a Nov y +195.75 CAJA40 a Dic — entregas/correcciones con `effective_date` retroactivo. El snapshot ya no es fuente de verdad para validación histórica.
6. **Hay 3 product.product con default_code='77201046'** en Odoo live: id=7090 activo (variante actual), id=1541 archivado, id=2371 archivado con default_code "077201046" (cero al inicio). La snapshot CSV usó el `product.template` id (9764) como `odoo_id`, no el `product.product` id. Coincidió por casualidad: template 9764 → variante 7090. Si llegáramos a tener variantes activas múltiples por SKU, la ingesta actual fallaría silenciosamente.

### Lo que queda abierto

- **Por qué Nov 2024 SSOT (6,466.25) > Odoo live actual (6,366.80) por 99.45 CAJA40.** Hipótesis (no verificadas):
  - El SSOT Nov se capturó en una fecha previa cuando Odoo live tenía más actividad de Nov registrada (luego se reversó/anuló alguna entrega).
  - El SSOT Nov usa una definición distinta de la de Dic (e.g., incluye órdenes en `cancel` que tuvieron entregas parciales).
  - El SSOT Nov agrega `stock.move` a nivel de picking (que reparte multi-shipment correctamente), no `sale.order.effective_date` (que atribuye toda la línea al primer shipment).
  - El SSOT incluye lineas históricas que estaban bajo el variante archivado id=1541 antes de la migración a id=7090 (hoy id=1541 tiene 0 líneas).

---

## 1. Recon A — CSV snapshot

**Script:** [recon_A_csv_snapshot.py](recon_A_csv_snapshot.py)
**Input:** [real_data/sale.order_20260303.csv](../../real_data/sale.order_20260303.csv), [sale.order.line_20260303.csv](../../real_data/sale.order.line_20260303.csv), [stock.move_2024.csv](../../real_data/stock.move_2024.csv), [uom.uom_20260303.csv](../../real_data/uom.uom_20260303.csv)
**Output:** [recon_A_csv_snapshot_results.json](recon_A_csv_snapshot_results.json), [recon_A_csv_snapshot_output.txt](recon_A_csv_snapshot_output.txt)

| Mes | A (raw) | A′ (raw) | B (raw) | B′ (raw) | A (UoM-norm) | A′ (UoM-norm) | stock.move neto |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2024-11 | 6,851.00 | 6,706.00 | **6,361.00** | 6,360.00 | 6,819.80 | 6,674.80 | 6,411.25 |
| 2024-12 | 6,653.00 | 6,296.00 | **6,301.00** | 6,384.00 | 6,545.75 | 6,188.75 | 6,505.475 |
| 2025-01 | 7,644.00 | 7,479.00 | 7,160.00 | 7,179.00 | 7,512.375 | 7,347.375 | — |
| 2025-02 | 6,047.00 | 5,607.00 | 5,434.00 | 5,493.00 | 5,992.40 | 5,552.40 | — |

**Total líneas SKU 77201046:** 6,157 (CAJA40: 6,035, PAQ CJ: 119, Unidad CJ: 3)
**Estados existentes en CSV:** Cancelado, Cotización, Cotización enviada, Esperando Aprobación, Orden de venta — **no existe `Bloqueado` ni `Pedido de venta` en este export**, así que el filtro `state IN ('sale','done')` se reduce a `state = 'Orden de venta'`.

---

## 2. Recon B — Supabase prod DB

**Script:** [recon_B_prod_supabase.py](recon_B_prod_supabase.py)
**Endpoint:** `https://plirrpkasyytpgzwwztl.supabase.co/rest/v1/`
**Tablas leídas:** `products`, `sale_orders`, `sale_order_lines`, `units_of_measure`, `demand_daily`, `stock_moves`, `stock_locations`
**Output:** [recon_B_prod_supabase_results.json](recon_B_prod_supabase_results.json), [recon_B_prod_supabase_output.txt](recon_B_prod_supabase_output.txt)

| Mes | sale_order_lines B (raw) | demand_daily qty | stock_moves a cliente / devuelto / neto |
|---|---:|---:|---:|
| 2024-11 | **6,361.00** | **6,361.00** | 6,568.25 / 157.00 / **6,411.25** |
| 2024-12 | **6,301.00** | **6,301.00** | 6,882.575 / 377.10 / **6,505.475** |
| 2025-01 | 7,160.00 | 7,160.00 | (no consultado) |
| 2025-02 | 5,434.00 | 5,434.00 | (no consultado) |

**Coincidencias 1:1 entre CSV (A) y prod DB (B):**
- Líneas para SKU 77201046: 6,157 ↔ 6,157 ✅
- B (eff/del): 6,361 / 6,301 ↔ 6,361 / 6,301 ✅
- A, A′, B′: idénticos en cada mes ✅
- stock.move neto: 6,411.25 / 6,505.48 ↔ 6,411.25 / 6,505.475 (sólo diferencia de redondeo de presentación)

**Conclusión recon B:** `scripts/ingest.py` no introdujo drift. La app refleja fielmente lo que está en prod, que refleja fielmente el snapshot.

---

## 3. Recon C — Odoo live (XML-RPC)

**Script principal:** [recon_C_odoo_live.py](recon_C_odoo_live.py)
**Script diagnóstico:** [recon_C2_odoo_live_diagnose.py](recon_C2_odoo_live_diagnose.py)
**Endpoint:** `https://suplicentro-2801-27990914.dev.odoo.com`  (DB `suplicentro-2801-27990914`, user `integracion@piensom.com`, uid 182)
**Output:** [recon_C_odoo_live_results.json](recon_C_odoo_live_results.json), [recon_C_odoo_live_output.txt](recon_C_odoo_live_output.txt), [recon_C2_odoo_live_diagnose_results.json](recon_C2_odoo_live_diagnose_results.json), [recon_C2_odoo_live_diagnose_output.txt](recon_C2_odoo_live_diagnose_output.txt)

### 3.1 Resolución de producto

| Campo | Snapshot CSV | Odoo live |
|---|---|---|
| `default_code` (SKU) | 77201046 | 77201046 |
| `id` usado por la app | 9764 (en realidad es **product.template id**) | — |
| `product.product.id` actual | — | **7090** (active) |
| `product.template.id` actual | — | **9764** ✅ confirma que coincide con el "odoo_id" de la app |
| `name` | "VASO DUROPORT No. 10 REYMA 40-25" | "Vaso Blanco 10oz Duroport ¨40/25 Reyma" |

**Hallazgos colaterales:**
- Existen **3 product.product con default_code='77201046'** en Odoo live: id=7090 (active, 5,741 líneas), id=1541 (archived, 0 líneas), id=2371 (archived, default_code='077201046' con cero al inicio, 0 líneas). El producto fue migrado de id=1541 → id=7090 manteniendo el mismo SKU y mismo template (9764).
- `scripts/ingest.py` guarda `product.template.id` como `products.odoo_id` (no `product.product.id`). Hoy funciona porque cada template tiene una variante, pero **es un bug latente** si llegara a haber productos con variantes activas múltiples.

### 3.2 Resultado por mes — Odoo live, normalizado a CAJA40

| Mes | A | A′ | B (eff_date) | B (commitment_date) | B (combinado: eff∥commit) | B′ |
|---|---:|---:|---:|---:|---:|---:|
| 2024-11 | 6,815.80 | 6,670.80 | 6,311.00 | 5,595.80 | **6,366.80** | 6,365.80 |
| 2024-12 | 6,549.75 | 6,192.75 | 6,351.00 | 7,367.75 | **6,496.75** | 6,579.75 |
| 2025-01 | 7,512.38 | 7,347.38 | 7,112.00 | 7,230.38 | 7,196.38 | 7,211.38 |
| 2025-02 | 5,992.40 | 5,552.40 | 5,464.00 | 5,236.40 | 5,510.40 | 5,573.40 |

**Estados existentes en Odoo live:** `['cancel', 'draft', 'sale', 'waiting_for_approval']` (no existe 'done'). El filtro `state IN ('sale','done')` se reduce a `state = 'sale'`.

### 3.3 Deltas vs SSOT por definición B

| Mes | SSOT | B(eff_date) | B(commitment_date) | B(combinado) |
|---|---:|---:|---:|---:|
| 2024-11 | 6,466.25 | 6,311.00 (Δ +155.25) | 5,595.80 (Δ +870.45) | **6,366.80 (Δ +99.45)** |
| 2024-12 | 6,496.50 | 6,351.00 (Δ +145.50) | 7,367.75 (Δ −871.25) | **6,496.75 (Δ −0.25)** ✅ |

**Lectura:** el SSOT y Odoo live coinciden EXACTAMENTE en Dic (a 0.25 CAJA40 = 1 línea de 10 PAQ CJ) usando la regla "effective_date si existe, si no commitment_date". Pero en Nov hay un gap de +99.45 CAJA40 que el SSOT excede a Odoo live actual.

---

## 4. Insight #1 — Estructura UoM y por qué la app NO sobrecuenta en B

El producto se vende casi siempre en CAJA40. En todo el histórico hay 3 UoMs:

| UoM | factor | líneas |
|---|---:|---:|
| CAJA40 (UoM de venta y stock) | 0.025 | 6,035 |
| PAQ CJ (UoM de referencia categoría "Caja") | 1.0 | 119 |
| Unidad CJ | 1.0 | 3 |

Conversión: `qty_CAJA40 = qty_PAQ_CJ × 0.025`.

**La app suma cantidades crudas** (sin normalizar UoM) en las columnas A y A′. Esto **infla** A y A′ cuando hay PAQ CJ (porque suma 32 PAQ CJ como si fueran 32 CAJA40). La normalización UoM corrige Nov A de 6,851 → 6,819.80 y Nov A′ de 6,706 → 6,674.80.

**PERO**: B y B′ (que filtran por `effective_date` y `delivered_qty > 0`) **NO cambian con normalización UoM**, porque en Nov/Dic 2024 **ninguna línea PAQ CJ tiene `effective_date` en esos meses**. La columna B = 6,361 / 6,301 es estable bajo cualquier interpretación UoM-aware del snapshot/prod. Por lo tanto:

> **Normalización UoM no puede explicar el delta SSOT vs B en este SKU para Nov/Dic 2024.**

---

## 5. Insight #2 — `stock.move` neto se acerca a SSOT pero no calza

| Mes | stock.move neto (a cliente − devuelto) | SSOT | Δ |
|---|---:|---:|---:|
| 2024-11 | 6,411.25 | 6,466.25 | **−55.00** |
| 2024-12 | 6,505.475 | 6,496.50 | **+8.975** |

Los decimales `.25` y `.475` provienen genuinamente de PAQ CJ → CAJA40 a nivel `stock.move` (Odoo registra los movimientos en CAJA40 con fracción cuando vienen de un picking en PAQ CJ). El SSOT podría estar usando una vista híbrida pero **los números no calzan exactamente**.

**Implicación:** la fuente del SSOT no es `stock.move` puro tampoco. Sigue apuntando a **datos posteriores al snapshot**.

---

## 6. Insight #3 — Δ Nov vs Δ Dic son distintos en tamaño

- Δ Nov = +105.25 (SSOT mayor que app)
- Δ Dic = +195.50 (SSOT mayor que app)

Si fuera un bug constante (e.g., conversión UoM faltante uniforme) los deltas serían proporcionales. Aquí no lo son. Esto sugiere que **lo que falta en la app son entregas/correcciones puntuales por mes**, no una transformación matemática sistemática. Eso es consistente con la H1 (Odoo live tiene movimientos posteriores al snapshot con fechas retroactivas).

---

## 7. Insight #4 — `aggregate_demand_daily()` está implementado correctamente

`demand_daily` contiene exactamente lo que pide [SSOT_VALIDATION.md](../../SSOT_VALIDATION.md):
- `effective_date` como fecha
- `delivered_qty` como cantidad
- `state IN ('sale','done')`
- `delivered_qty > 0`

Verificado contra prod: `demand_daily` agg para Nov 2024 = 6,361.00 (24 días, 0 censurados). Eso es 100% consistente con la columna B de la app y con el SQL en [supabase/migrations/20260323000001_fix_demand_ssot.sql](../../supabase/migrations/20260323000001_fix_demand_ssot.sql).

**No hay bug en la lógica de agregación.** El bug, si existe, está río arriba (datos faltantes en el snapshot) o en la interpretación del SSOT (definición distinta a la documentada).

---

## 8. Insight #5 — Estados `Bloqueado` y `Pedido de venta` no aparecen en este export

El mapeo de `scripts/ingest.py:54-61` traduce:
```
'Bloqueado'        → 'done'
'Pedido de venta'  → 'sale'
'Orden de venta'   → 'sale'
```

Pero el CSV `sale.order_20260303.csv` **solo contiene** los estados: `Cancelado`, `Cotización`, `Cotización enviada`, `Esperando Aprobación`, `Orden de venta`. Hay 0 órdenes en `Bloqueado` y 0 en `Pedido de venta`.

Esto es importante porque significa que `state IN ('sale','done')` en el snapshot/prod equivale a `state = 'Orden de venta'`. Si Odoo live tiene órdenes en `Bloqueado` (e.g., órdenes cerradas posteriores a marzo 2026 con fechas efectivas retroactivas a Nov/Dic 2024), aparecerían adicionalmente en C pero no en A/B. **Esa es otra forma plausible en que C podría producir 6,466.25 / 6,496.50 sin coincidir con A/B.**

---

## 9. Próximos pasos

1. **Pregunta abierta para el usuario (bloqueante para cerrar Nov):**
   - ¿De dónde sacaste 6,466.25 para Nov 2024?
   - ¿En qué momento (fecha/hora) consultaste Odoo? Si fue hace varios días, alguna entrega Nov pudo haberse anulado o devuelto entre esa fecha y hoy (lo que reduciría el live actual respecto al SSOT capturado entonces).
   - ¿Filtraste por algún campo adicional (vendedor, almacén, cliente)?
   - ¿La consulta fue al modelo `sale.order.line` o a `sale.report` (vista materializada en Odoo)? Las dos pueden divergir.

2. **Acción técnica recomendada — re-ingest desde Odoo live.** El snapshot 2026-03-03 ya tiene 51 días y la prod DB de la app está desfasada. Dos rutas:
   - **(a) Quick win:** un script de re-export que vacía `sale_orders`, `sale_order_lines`, `stock_moves` y los repuebla vía XML-RPC contra Odoo live, luego re-corre `aggregate_demand_daily()`. ETA ~1 día. Resuelve Dic exactamente; Nov queda como pendiente de aclarar con Luis.
   - **(b) Correcto a largo plazo:** construir el live-sync incremental ya planeado en [_ODOO_EXPLORATION_PLAN.md](../../_ODOO_EXPLORATION_PLAN.md) (Phase 3, no se ejecutó aún). Sincroniza por delta diariamente. ETA ~1 semana.

3. **Bug latente a corregir:** `scripts/ingest.py` mapea `product.template.id` → `products.odoo_id`. Funciona hoy porque cada template tiene una variante, pero rompería con productos multivariante. Cambiar a `product.product.id` (el ID real de la variante) o agregar un check defensivo.

4. **Para Nov 2024 específicamente** — opciones para investigar el +99.45 gap si te urge cerrar:
   - Verificar si hay órdenes Nov 2024 en estado `cancel` que tuvieran `qty_delivered > 0` antes de cancelarse (una "entrega-luego-cancelación" típica que algunos reportes incluyen y otros no).
   - Sumar `stock.move` a nivel de picking para Nov 2024 cliente-bound (atribución por fecha real de ship, no por sale.order.effective_date).
   - Comparar contra el módulo `sale.report` de Odoo si está accesible.
   Puedo implementar cualquiera de estos como Recon D si me lo pides.

---

## 10. Archivos producidos

| Tipo | Archivo |
|---|---|
| Recon A script | [recon_A_csv_snapshot.py](recon_A_csv_snapshot.py) |
| Recon A resultados (JSON) | [recon_A_csv_snapshot_results.json](recon_A_csv_snapshot_results.json) |
| Recon A stdout | [recon_A_csv_snapshot_output.txt](recon_A_csv_snapshot_output.txt) |
| Recon B script | [recon_B_prod_supabase.py](recon_B_prod_supabase.py) |
| Recon B resultados (JSON) | [recon_B_prod_supabase_results.json](recon_B_prod_supabase_results.json) |
| Recon B stdout | [recon_B_prod_supabase_output.txt](recon_B_prod_supabase_output.txt) |
| Recon C script (ejecutado) | [recon_C_odoo_live.py](recon_C_odoo_live.py) |
| Recon C resultados (JSON) | [recon_C_odoo_live_results.json](recon_C_odoo_live_results.json) |
| Recon C stdout | [recon_C_odoo_live_output.txt](recon_C_odoo_live_output.txt) |
| Recon C2 diagnóstico script | [recon_C2_odoo_live_diagnose.py](recon_C2_odoo_live_diagnose.py) |
| Recon C2 diagnóstico resultados | [recon_C2_odoo_live_diagnose_results.json](recon_C2_odoo_live_diagnose_results.json) |
| Recon C2 stdout | [recon_C2_odoo_live_diagnose_output.txt](recon_C2_odoo_live_diagnose_output.txt) |
| Análisis previo (v1–v4 exploratorios) | [reconcile_77201046_v1.py](reconcile_77201046_v1.py), [v2](reconcile_77201046_v2.py), [v3](reconcile_77201046_v3.py), [v4](reconcile_77201046_v4.py) |
| Reporte técnico inicial | [SKU_77201046_NOV_DIC_2024_RECONCILIATION.md](SKU_77201046_NOV_DIC_2024_RECONCILIATION.md) |
