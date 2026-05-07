# Purchase Data Completeness — Findings and Contrast Analysis
**Date:** 2026-04-29  
**Scope:** All 23 demo SKUs. Production Supabase only. No assumptions.

---

> **STATUS: RESOLVED — 2026-05-07**
>
> The data gap documented in this file has been fully closed. The root cause was confirmed: the 14 Tier-3/Tier-4 SKUs receive goods through `stock.picking "Recibidos Internacional"` (writing to `stock_moves`), not through `purchase.order`. All 14 PIDs have 15–16 months of real purchase coverage in `revenue_daily_for_ml`. The stoplight distribution is now 20 GREEN / 3 AMBER / 0 RED.
>
> **What was done and how:**
> - `docs/reconciliation/find_15b_supplement_purchases_from_stock_moves_2026-05-06.py` — reads `stock_moves` (vendor→internal, `state=done`) for the 14 red-tier PIDs and inserts 3,139 rows into `revenue_daily`.
> - `docs/reconciliation/recompute_po_history_real_months_2026-05-07.py` — recomputes `products_acid_test_active.po_history_real_months` from `revenue_daily_for_ml`; patched 8 rows from 2 → 16.
> - Full ML retrain (Pass 1 + Pass 2) completed; 138/138 forecast cells confirmed.
> - Pipeline order (authoritative): `find_15` → `find_15b` → `smooth_oct2024` → `recompute_po_history_real_months` → ML training. `find_16` is deprecated — must not be run.
>
> **Full detailed record:** [`changelogs/2026-05-06-07_purchase-history-gap-fix-red-tier-skus.md`](../../changelogs/2026-05-06-07_purchase-history-gap-fix-red-tier-skus.md)
>
> The historical analysis below is preserved as-written — it documents the reasoning and evidence that led to the fix.

---

---

## The Contrast That Triggered This Document

Two responses, same session, same database, same 23 SKUs — diametrically opposed conclusions.

**Response A — earlier session (before context compression):**
> *"The approach is definitely feasible — the tables exist, all 23 demo SKUs are covered, I have the complete state data including 2,477 locked POs, and `product_id` is already properly set up as a Supabase foreign key to `products.id`."*

**Response B — recent session:**
> *"SKU 77205001 has 11 purchase order lines in the entire Supabase database, all from October and November 2024. There are zero confirmed POs from December 2024 through January 2026."*

Both statements are factually correct. The contradiction is not an error — it is a precision failure. Response A measured completeness at the **table level** (does the table exist, are the joins correct, do the product IDs match, are locked POs included?). Response B measured completeness at the **per-SKU level** (does THIS specific product have purchase history across the training window?). These are two different questions. Only the second question matters for the ML pipeline.

---

## What "2,477 Locked POs" Actually Means

The `purchase_orders` table contains 3,253 total orders. 2,477 are in `locked` state. These are real production POs.

However, these 3,253 orders are distributed across **892 distinct products**. The 23 demo SKUs account for only **569 of the 16,159 purchase order lines** — 3.5% of all lines in the table.

| Scope | POL rows | Share of total |
|---|---|---|
| All products (892) | 16,159 | 100% |
| 23 demo SKUs only | 569 | 3.5% |

"Complete data including 2,477 locked POs" is a true statement about the table. It is a misleading statement about the 23 demo SKUs.

---

## Per-SKU Purchase Coverage — Full Audit

Training window: 2024-10 through 2026-01 (16 months). All data queried directly from `purchase_orders` + `purchase_order_lines`, states `purchase/locked/done` only, quantities normalized to CAJA40.

### Tier 1 — Full History (16/16 months)

Seven SKUs have confirmed purchase data in every single month of the training window. All seven are REYMA products.

| pid | SKU | Name | Total POL lines | Months |
|---|---|---|---|---|
| 20 | 77201041 | ENVASE DUROPORT REYMA 16 ONZ. | 64 | 16/16 |
| 33 | 77201046 | Vaso Blanco 10oz Duroport Reyma | 91 | 16/16 |
| 469 | 77201069 | CLING FILM 12" X 2000' REYMA | 40 | 16/16 |
| 539 | 77201038 | CONT. REYMA DUR. P/HAMBURGUESA | 61 | 16/16 |
| 1366 | 77201014 | TAPA PLAST P/ENV. 16-32 ONZ. REYMA | 70 | 16/16 |
| 1562 | 77201047 | VASO DUROPORT No. 12 REYMA | 68 | 16/16 |
| 1606 | 77201053 | VASO No.16 TRANSPARENTE REYMA | 74 | 16/16 |

These are the only 7 SKUs for which the derived ratio approach has a statistically meaningful training base. Monthly purchase volumes are consistent and well-distributed. The Tukey fence correctly excludes anomaly months (Jan 2026 bulk pre-buys where present).

### Tier 2 — Partial History (3–5 months)

Two SKUs have purchase data in multiple non-consecutive windows, both CARVAJAL/imported biodegradables.

| pid | SKU | Name | Months | Notes |
|---|---|---|---|---|
| 37 | 77205207 | VASO No 8 OZ VIVA DUROPORT BIO | 5/16 | Oct'24, Oct-Nov-Dec'25, Jan'26. Jan'26=116,722 CAJA40 bulk pre-buy excluded by Tukey |
| 1035 | 77205187 | PLATO 6 DUROPORT BIO FOM VIVA | 5/16 | Oct'24, Nov'24 (trivial 17 units), Nov-Dec'25, Jan'26 |

For these two, the ratio is computable but based on limited data. Tukey correctly handles the Jan 2026 spikes. The resulting R values are defensible as estimates, not reliable as stable long-run ratios.

### Tier 3 — Onboarding-Only (1–2 months, all from Oct 2024 batch)

Fourteen SKUs have purchase data almost exclusively from the October 2024 onboarding batch. After that initial load, the Supabase `purchase_orders` / `purchase_order_lines` tables contain no further purchase activity for these products.

| pid | SKU | Name | supplier_origin | Months | Notes |
|---|---|---|---|---|---|
| 2 | 77205001 | BANDEJA 2P TERMO FOM BIO 10/50 | el_salvador | 2/16 | Oct'24 + Nov'24 |
| 3 | 77205287 | BANDEJA 2P VIVA FOM BIO 10/50 | el_salvador | 2/16 | Oct'24 + Nov'24 |
| 5 | 77205003 | BANDEJA No.1 BIO TERMOFOM 5X50 | el_salvador | 1/16 | Oct'24 only |
| 29 | 77205034 | PORTACOMIDA BIO 7X7 C/D TERMO | el_salvador | 1/16 | Oct'24 only |
| 34 | 77201000 | VASO DUROPORT No. 8 REYMA | — | 2/16 | Oct'24 + Nov'24 |
| 36 | 77205208 | VASO No 10 OZ VIVA DUROPORT BIO | el_salvador | 1/16 | Oct'24 only |
| 145 | 77205190 | BANDEJA No.2 DUROPORT BIO VIVA | el_salvador | 1/16 | Oct'24 only |
| 1069 | 77205002 | PLATO No. 6 BIO TERMOFOM | — | 2/16 | Oct'24 + Oct'25 (non-consecutive) |
| 1096 | 77201023 | PLATO REYMA DUROPORT #8 HONDO | — | 2/16 | Oct'24 + Nov'24 |
| 1113 | 77205035 | PORTACOMIDA 7X7 LISO TERMO 4/50 | — | 1/16 | Oct'24 only |
| 1127 | 77205005 | PORTACOMIDA 8X8 C/D T-FOM | — | 1/16 | Oct'24 only |
| 1587 | 77201019 | VASO No. 10 TRANSPARENTE REYMA | — | 2/16 | Oct'24 + Nov'24 |
| 1590 | 77201055 | VASO No. 12 TRANSPARENTE REYMA | — | 2/16 | Oct'24 + Nov'24 |
| 1600 | 77201056 | VASO No. 8 TRANSP. REYMA | — | 2/16 | Oct'24 + Nov'24 |

**Summary: 14 of 23 demo SKUs have purchase data for 1–2 months out of 16.** For these SKUs, the derived ratio is computed from onboarding-era data that is structurally different from steady-state operations.

---

## Why These SKUs Are Missing from Supabase

Three distinct mechanisms explain the absence:

**Mechanism 1 — El Salvador imports (pids 2, 3, 5, 29, 36, 145)**  
Six SKUs have `supplier_origin = 'el_salvador'`. These are imported products. Their procurement likely follows an import order workflow — possibly outside standard Odoo PO mechanics, or using a document type that was not included in the Supabase sync scope. The Supabase `purchase_orders` table was populated from Odoo's `purchase.order` model. If import orders are tracked under a different Odoo model (e.g., direct stock moves, inter-company transfers, or a customs broker workflow), they would not appear here.

**Mechanism 2 — Reyma transparent cups (pids 34, 1587, 1590, 1600) and other FARDO products**  
These are REYMA products with stock UoM CAJA20 or CAJA40. Yet they have only 1–2 months of purchase data while other REYMA SKUs (pids 20, 33, 469, 539, 1366, 1562, 1606) have 16 months. The difference correlates with total POL line count: the 7 well-covered REYMA SKUs average 67 POL lines; the under-covered REYMA SKUs average 5. This suggests these products were procured through a different workflow, possibly blanket orders, standing replenishment agreements, or supplier-managed inventory that generates fewer discrete POs.

**Mechanism 3 — Onboarding artifact only (pids 1113, 1127, 1069, 1096, 1035)**  
These have 1–2 POL lines total. Some have one Oct 2024 onboarding PO and nothing else. The company may replenish them via the same orders as related products (e.g., portacomidas bundled with bandejas from the same supplier), meaning the line-level product_id attribution is concentrated on the primary SKU.

---

## Impact on Revenue_Daily and the Derived Ratio

The `revenue_daily` table is populated by `find_15`, which reads from `purchase_orders` + `purchase_order_lines`. `revenue_daily_for_ml` is rebuilt from `revenue_daily` by the smoothing script. The derived ratio module reads from `revenue_daily_for_ml`. Therefore, the data gap propagates directly into the ratio computation.

**Actual derived ratios used in the current forecast_results (from fix script run 2026-04-29):**

| pid | SKU | R_ord | months_used | months_excluded | Data quality |
|---|---|---|---|---|---|
| 20 | 77201041 | 0.5923 | 16 | 0 | RELIABLE |
| 33 | 77201046 | 1.2877 | 16 | 0 | RELIABLE |
| 469 | 77201069 | 0.0308 | 16 | 0 | RELIABLE |
| 539 | 77201038 | 0.2988 | 14 | 2 | RELIABLE |
| 1366 | 77201014 | 0.6436 | 16 | 0 | RELIABLE |
| 1562 | 77201047 | 1.1168 | 16 | 0 | RELIABLE |
| 1606 | 77201053 | 1.2102 | 16 | 0 | RELIABLE |
| 37 | 77205207 | 0.9048 | 4 | 1 | LIMITED |
| 1035 | 77205187 | 0.4651 | 3 | 2 | LIMITED |
| 2 | 77205001 | **0.0162** | **2** | **0** | **UNRELIABLE** |
| 3 | 77205287 | 0.0571 | 2 | 0 | UNRELIABLE |
| 5 | 77205003 | 0.4969* | 15 | 1 | FALLBACK (class median) |
| 29 | 77205034 | 0.4969* | 15 | 1 | FALLBACK (class median) |
| 34 | 77201000 | 0.4062 | 2 | 0 | UNRELIABLE |
| 36 | 77205208 | 0.4969* | 15 | 1 | FALLBACK (class median) |
| 145 | 77205190 | 0.4969* | 15 | 1 | FALLBACK (class median) |
| 1069 | 77205002 | 0.6778 | 2 | 0 | UNRELIABLE |
| 1096 | 77201023 | 0.3380 | 2 | 0 | UNRELIABLE |
| 1113 | 77205035 | 0.4969* | 15 | 1 | FALLBACK (class median) |
| 1127 | 77205005 | 0.4969* | 15 | 1 | FALLBACK (class median) |
| 1587 | 77201019 | 0.6274 | 2 | 0 | UNRELIABLE |
| 1590 | 77201055 | 0.8300 | 2 | 0 | UNRELIABLE |
| 1600 | 77201056 | 1.0345 | 2 | 0 | UNRELIABLE |

*FALLBACK = class median ratio (R_ORD=0.4969, R_RCV=0.5687) injected by `find_16` because raw data showed 0 usable months.

**Note on SKUs 5, 29, 36, 145, 1113, 1127:** These show "months_used=15" in the fix script because `find_16` synthetically populated `revenue_daily_for_ml` for these SKUs using the class median ratio. The 15 months of "purchase data" are synthetic — they were computed from sales × R_class and inserted by the fallback script. The ratio the derived module computes for these SKUs is therefore approximately R_class by construction. This is circular: the fallback inserts data at R=0.4969 → the derived module reads that data → computes R≈0.4969. The prediction is self-referential, not independently validated.

---

## What the App Is Actually Showing

Returning to the screenshot that triggered this investigation — SKU 77205001 (pid=2):

| Metric | Displayed value (Feb 2026) | Source |
|---|---|---|
| Sales | 35,172 CAJA40 | Prophet, trained on 16 months of daily sales data — dense, reliable |
| Purchases Ordered | 570 CAJA40 | Derived ratio: 35,172 × R=0.0162 |
| Purchases Received | 570 CAJA40 | Derived ratio: 35,172 × R=0.0162 |

R=0.0162 comes from:
- Oct 2024 (smoothed to 598.75 CAJA40) / Oct 2024 sales (34,442.80) = 0.0174
- Nov 2024 (598.75 CAJA40) / Nov 2024 sales (39,791.50) = 0.0151
- Tukey median of [0.0174, 0.0151] = ~0.0162

The historical purchase data document (`ML_TRAINING_DATA_FINDINGS_2026-04-28.md`) shows this SKU had purchases of **35,000–63,000 CAJA40 per month** throughout the training window under the old `pol_all_states` label. That data — which included all Odoo PO states — captured purchase volumes that the confirmed-only Supabase tables do not.

**The 570 CAJA40 forecast is wrong.** It is precisely 100× too small for the apparent operational reality of this SKU. The number is defensible as a correct calculation from the available data. The available data is the problem.

---

## Root Diagnosis: What "Complete Data" Means and Does Not Mean

The earlier session's conclusion — "complete data including all 2,477 locked POs" — was correct in this specific sense: the Supabase `purchase_orders` table captures 100% of the POs that were entered through Odoo's standard purchase order workflow and synced to Supabase. No rows are missing from the table. The product_id FK joins are correct. The UoM conversion is correct. The locked PO state is correctly included.

What it does NOT mean: that every product's entire replenishment activity is captured by Odoo POs. For 14 of the 23 demo SKUs, operational replenishment for Nov 2024–Jan 2026 appears to occur through channels that produce zero or near-zero rows in `purchase_orders`. Whether this is import workflow, consignment, blanket orders, or incomplete Odoo adoption by the procurement team is unknown from database inspection alone — it requires direct verification against Luis's Odoo dashboard.

---

## Open Questions — Require External Input

The following cannot be resolved from database queries alone:

1. **How does the company replenish the 14 Tier-3 SKUs in practice?** For pid=2 (77205001), the company sells ~35,000 CAJA40/month but has 11 confirmed purchase order lines spanning 2 months. Physical inventory does not grow from nothing. There must be a procurement mechanism not captured in `purchase_orders`.

2. **Are import orders (El Salvador, Guatemala customs) tracked in a separate Odoo model?** If so, which model and were those records synced to Supabase?

3. **What does Luis's Odoo dashboard show for purchases_ordered for SKU 77205001 in Feb and Mar 2026?** This is the ground truth. Comparing against our 570 CAJA40 prediction will confirm whether the data gap is real or whether we are misidentifying the procurement mechanism.

4. **For REYMA transparent cups (pids 34, 1587, 1590, 1600):** These are domestic REYMA products. Why do they have 2 months of purchase data while other REYMA products (pids 20, 33, 469, 539, 1366, 1562, 1606) have 16? Are these products ordered on a different schedule, under blanket contracts, or is there an Odoo sync gap specific to these SKUs?

---

## Summary Table

> **Updated 2026-05-07** — Original classifications shown for historical context. The "action needed" column reflects the state as of 2026-04-29; see the resolution banner at the top for current status.

| Classification | SKUs | Forecast quality (as of 2026-04-29) | Forecast quality (as of 2026-05-07) | Resolution |
|---|---|---|---|---|
| Tier 1 — Full history, REYMA | 7 (pids 20, 33, 469, 539, 1366, 1562, 1606) | Reliable | **Reliable** | Unchanged — always GREEN |
| Tier 2 — Partial history | 2 (pids 37, 1035) | Limited, usable | **Limited, usable** | Unchanged — 5/16 months confirmed correct |
| Tier 3 — Fallback (class median, synthetic) | 6 (pids 5, 29, 36, 145, 1113, 1127) | Self-referential, not independently validated | **Reliable (real data)** | `find_15b` populated 16 real stock_moves months. `find_16` synthetic fallback deprecated. |
| Tier 4 — Onboarding data only | 8 (pids 2, 3, 34, 1069, 1096, 1587, 1590, 1600) | Unreliable — 1–2 months | **Reliable (real data)** | `find_15b` populated 15–16 real stock_moves months for all 8 PIDs. |

**Bottom line (2026-05-07):** The derived ratio purchase forecast is now reliable for 20 of 23 demo SKUs. The remaining 3 AMBER SKUs (77205187, 77205207 at 5/16; 77205287 at 15/16) reflect genuine procurement patterns, not data gaps. Zero RED SKUs.

The `purchase_orders` / `purchase_order_lines` tables in Supabase are not a complete picture of this company's purchasing activity — that finding stands. For the 14 import-channel SKUs, the complete record is in `stock_moves` (vendor→internal receipts). The `find_15b` supplement script bridges this gap in the ML pipeline.

---

## Open Questions — Status as of 2026-05-07

The four open questions from the original document have been resolved:

**1. How does the company replenish the 14 Tier-3 SKUs in practice?**
→ Confirmed: `stock.picking "Recibidos Internacional"` — stock receipt moves from `from_location_id = 41` (Partners/Vendors) to internal locations. No `purchase.order` header is created. The complete 16-month receipt history for all 14 PIDs exists in `stock_moves`.

**2. Are import orders tracked in a separate Odoo model?**
→ Confirmed: yes — `stock.picking` receipts, not `purchase.order`. The Supabase `stock_moves` table contains these records with `state = 'done'` and full date/quantity coverage.

**3. What does the Odoo dashboard show for SKU 77205001 purchases in Feb and Mar 2026?**
→ The client insider confirmed real data is complete. The `stock_moves` query verified 16/16 months of receipt coverage. The R value computed from real data is 0.2487 (15 months, 1 outlier excluded by Tukey). This replaces the previous R=0.0162 (2 onboarding months only).

**4. Why do the REYMA transparent cups have only 2 months of purchase data while other REYMA SKUs have 16?**
→ Confirmed by `stock_moves` query: these products (pids 34, 1587, 1590, 1600) receive their inventory through the same "Recibidos Internacional" channel as the CARVAJAL import SKUs. The 16-month stock_moves record confirms continuous replenishment throughout the training window.
