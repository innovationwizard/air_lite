# Reconciliation Analytics — SKU 77201046 (Nov/Dic 2024)

**Producto:** VASO DUROPORT No. 10 REYMA 40-25
**SKU:** 77201046
**UoM de venta/stock:** CAJA40
**Conversión clave:** 1 CAJA40 = 40 PAQ CJ
**SSOT declarado por usuario:** Nov 2024 = **6,466.25** | Dic 2024 = **6,496.50**

**Fecha de la corrida:** 2026-04-23

---

## 0. Resumen ejecutivo

| Fuente | Definición B (eff_date + delivered_qty) | Δ vs SSOT Nov | Δ vs SSOT Dic |
|---|---:|---:|---:|
| A — CSV snapshot 2026-03-03 (`real_data/`) | 6,361 / 6,301 | **+105.25** | **+195.50** |
| B — Supabase prod DB (`plirrpkasyytpgzwwztl`) | 6,361 / 6,301 | **+105.25** | **+195.50** |
| C — Odoo live (`suplicentro-2801-27990914.dev.odoo.com`) | **bloqueado** — falta `ODOO_API_KEY` | — | — |

### Conclusiones firmes (sobre lo que SÍ pude verificar)

1. **No hay drift entre CSV y prod DB.** Las cifras son idénticas a 4 decimales. La ingesta `scripts/ingest.py` no introdujo discrepancias.
2. **La app está mostrando el dato correcto** según el contrato definido en [SSOT_VALIDATION.md](../../SSOT_VALIDATION.md): `effective_date + delivered_qty`, `state IN ('sale','done')`, `delivered_qty > 0`. La función `aggregate_demand_daily()` produce 6,361 / 6,301, que es lo que `demand_daily` contiene en prod, que es lo que `/gerencia/validacion` muestra.
3. **El SSOT 6,466.25 / 6,496.50 NO existe en el snapshot ni en prod DB** bajo ninguna combinación de filtros (probadas 30 combinaciones de date_basis × qty_col × state × del_filter).
4. **Los decimales `.25` y `.50` del SSOT son geométricamente compatibles** con normalización UoM PAQ CJ → CAJA40 (10 PAQ CJ = 0.25 CAJA40, 20 PAQ CJ = 0.5 CAJA40). Pero esa normalización aplicada al snapshot/prod **no cierra** porque ningún PAQ CJ de Nov/Dic 2024 tiene `effective_date` en esos meses.
5. **La explicación más probable es C** — el SSOT proviene de Odoo live (data más reciente que el snapshot del 2026-03-03). Hace 28 días que se exportó el snapshot; cualquier nota de crédito o corrección con fecha contable retroactiva a Nov/Dic 2024 no está en CSV ni en prod DB pero sí estaría en Odoo live.

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

## 3. Recon C — Odoo live (PENDIENTE — falta API key)

**Script:** [recon_C_odoo_live.py](recon_C_odoo_live.py) (listo para correr)
**Endpoint:** `https://suplicentro-2801-27990914.dev.odoo.com`  (DB `suplicentro-2801-27990914`, user `integracion@piensom.com`)
**Output esperado:** `recon_C_odoo_live_results.json`

**Bloqueo:** falta variable de entorno `ODOO_API_KEY`. La memoria de proyecto del 2026-03-26 indica que la API key fue recibida pero no la encuentro en `.env`, `.env.local`, ni en el shell.

**Para destrabar:**
```bash
echo "ODOO_API_KEY=<la-api-key>" >> /Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env.local
cd /Users/jorgeluiscontrerasherrera/Documents/_git/air_lite && python3 docs/reconciliation/recon_C_odoo_live.py
```

El script:
1. Autentica vía XML-RPC (`/xmlrpc/2/common`).
2. Resuelve `product.product` por `default_code = '77201046'`.
3. Lee todas las líneas de `sale.order.line` para ese producto.
4. Lee los `sale.order` correspondientes con `date_order`, `commitment_date`, `effective_date`, `state`.
5. Lee `uom.uom` para normalizar todas las cantidades a la UoM de stock del producto (CAJA40).
6. Calcula A, A′, B (combinado), B (`commitment_date` solo), B (`effective_date` solo) por mes.
7. Reporta deltas vs SSOT 6,466.25 / 6,496.50.

**Hipótesis previa a correr:**
- Si Odoo live devuelve **6,466.25 / 6,496.50** → SSOT confirmado, snapshot está atrasado, **acción:** re-ingestar desde Odoo live.
- Si Odoo live devuelve **6,361 / 6,301** (igual a snapshot) → la fuente del SSOT del usuario es OTRA (no es la API que vemos), **acción:** preguntar al usuario qué reporte/UI generó esos números.
- Si Odoo live devuelve algo intermedio → existe corrección parcial post-snapshot, podemos calcular el delta exacto y decidir si hacer re-sync.

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

1. **Bloqueante para cerrar este caso:** correr Recon C. Necesito `ODOO_API_KEY`. ¿Me la pasas o la pongo yo en `.env.local` si me dictas el valor?
2. Si C confirma SSOT → re-ingestar Odoo live. Hay dos rutas:
   - **(a)** Re-export CSV completo (Luis pide a su gente IT) → re-correr `scripts/ingest.py` → re-correr `aggregate_demand_daily()`.
   - **(b)** Construir el live-sync que estaba planeado (`ml/odoo_sync_*.py`) → sincronización incremental periódica.
3. Si C **no** confirma SSOT → preguntar al usuario qué reporte/UI generó 6,466.25 / 6,496.50, porque ninguna de las 3 fuentes técnicamente accesibles produce esos números.

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
| Recon C script (listo, no ejecutado) | [recon_C_odoo_live.py](recon_C_odoo_live.py) |
| Recon C último intento (sin API key) | [recon_C_odoo_live_output.txt](recon_C_odoo_live_output.txt) |
| Análisis previo (v1–v4 exploratorios) | [reconcile_77201046_v1.py](reconcile_77201046_v1.py), [v2](reconcile_77201046_v2.py), [v3](reconcile_77201046_v3.py), [v4](reconcile_77201046_v4.py) |
| Reporte técnico inicial | [SKU_77201046_NOV_DIC_2024_RECONCILIATION.md](SKU_77201046_NOV_DIC_2024_RECONCILIATION.md) |
