# Plan — Fix `products.odoo_id` semantics (template_id leaking as product_id)

**Status:** Draft, awaiting decisions on open questions (§9).
**Owner:** TBD
**Created:** 2026-04-23
**Adheres to:** [_THE_RULES.MD](../../_THE_RULES.MD) — production-first, no assumptions, enterprise-grade, no mock data.

---

## 1. Bug statement (verified, not assumed)

`products.odoo_id` (defined as a `VARCHAR(50) UNIQUE NOT NULL` foreign key to Odoo's `product.product.id`) is **populated with `product.template.id` instead** for the majority of rows in production.

### 1.1 Evidence

Verified against live Odoo (`suplicentro-2801-27990914.dev.odoo.com`) and prod Supabase (`plirrpkasyytpgzwwztl.supabase.co`) on 2026-04-23 via [scope_check_odoo_id_bug.py](scope_check_odoo_id_bug.py).

| Metric | Count | % of total |
|---|---:|---:|
| `products` rows in Supabase prod | 1,653 | 100.0% |
| `odoo_id` matches an active `product.product.id` | 366 | 22.1% |
| `odoo_id` matches an **archived** `product.product.id` | 110 | 6.7% |
| `odoo_id` does NOT match any `product.product.id` | **1,177** | **71.2%** |
| └ of those, matches a `product.template.id` instead | 1,148 | 69.4% |
| └ of those, matches nothing (orphan in Odoo) | 29 | 1.8% |

**Why the system works today (latent bug):** all 1,148 templates whose ID leaked into `odoo_id` happen to have exactly **1 variant**. Variant count > 1 = bug activates.

### 1.2 Multivariant exposure (Odoo live, today)

| Metric | Count |
|---|---:|
| Distinct SKUs (`default_code`) in Odoo `product.product` | 1,795 |
| SKUs with multiple `product.product` records (any state) | 1,101 |
| SKUs with multiple **active** `product.product` records | **2** |
| Supabase SKUs not found in Odoo live (deleted/renamed) | 18 |
| Supabase products with NULL/empty SKU | 48 |
| Supabase SKUs with internal duplicates | 2 |

The 2 active-multivariant SKUs are the immediate risk surface for SKU-based matching ([ml/odoo_sync_oa_v2.py:116-127](../../ml/odoo_sync_oa_v2.py)). The 1,101 historical-multivariant SKUs are why a snapshot taken at time T can become out-of-sync with live (case: SKU 77201046 was variant id=1541 archived → variant id=7090 active).

### 1.3 Root cause

[scripts/ingest.py:209](../../scripts/ingest.py) reads `row['ID']` from `real_data/product.product_20260303.csv` and stores it directly as `products.odoo_id`. The CSV was exported from Odoo's UI in template-context (likely via Sales → Products view, which displays one row per template), so the "ID" column holds `product.template.id`, **not** `product.product.id`. The CSV filename is misleading.

---

## 2. Impact assessment (current and future)

### 2.1 Today — LOW impact

`products.odoo_id` is **not referenced** by any:
- RPC function in [supabase/migrations/](../../supabase/migrations/)
- API route in [frontend/src/app/api/](../../frontend/src/app/api/)
- UI component
- Downstream ingest tables (which join via Supabase `products.id`)

Sync script [ml/odoo_sync_oa_v2.py](../../ml/odoo_sync_oa_v2.py) already matches by SKU (`default_code`), bypassing `odoo_id` entirely.

### 2.2 Tomorrow — HIGH impact

Three concrete scenarios where the bug bites:

1. **Live incremental sync** ([_ODOO_EXPLORATION_PLAN.md](../../_ODOO_EXPLORATION_PLAN.md) Phase 3, not yet built). A delta sync that reads Odoo `sale.order.line.product_id` (which is `product.product.id`) cannot resolve to a Supabase `products.id` via `odoo_id` because 71% of `odoo_id` values are wrong.
2. **Deep-link to Odoo from the app.** Any "View in Odoo" link to `/odoo/web#id=<odoo_id>&model=product.product` opens the wrong record (template vs product) for 71% of SKUs.
3. **Multivariant SKUs.** Today 2 SKUs; tomorrow potentially more as the client adds variants. SKU-based matching is non-deterministic when multiple active variants share `default_code`.

### 2.3 Adjacent latent bug — `ml/odoo_sync_oa_v2.py` SKU collision

[ml/odoo_sync_oa_v2.py:114-117](../../ml/odoo_sync_oa_v2.py) builds `odoo_by_sku = {sku: p}` — overwrites silently on collision. With 1,101 SKUs having multiple records (typically active + archived) and 2 with multiple actives, the "last wins" can be the archived one or wrong active. Must be addressed in the same plan.

---

## 3. Design — target schema

### 3.1 Principle

Separate the two foreign keys explicitly. Don't reuse `odoo_id` for both because the column lies — silent type confusion is the worst kind of bug.

### 3.2 Target columns on `products`

| Column | Type | Constraint | Source field in Odoo | Notes |
|---|---|---|---|---|
| `id` | SERIAL PK | NOT NULL | — | unchanged |
| `sku` | VARCHAR(50) | UNIQUE (proposed)¹ | `product.product.default_code` | already exists |
| `odoo_product_id` | INT | UNIQUE (partial: `WHERE odoo_product_id IS NOT NULL`) | `product.product.id` | **new** — the variant-level surrogate key |
| `odoo_template_id` | INT | (no unique — multivariant possible) | `product.product.product_tmpl_id` | **new** — the template-level surrogate key |
| `odoo_id` | VARCHAR(50) | drop UNIQUE; keep column for compat one release; deprecate | — | **deprecated**; remove after backfill is verified |

¹ `sku UNIQUE` requires resolving the 2 internal SKU-duplicate rows first (§9 Q4). If we cannot make SKU unique, we must keep `odoo_product_id UNIQUE` as the only stable identity.

### 3.3 Why partial unique on `odoo_product_id`

Some products may not exist in current Odoo live (the 29 orphans) — they need to remain in our DB for historical reporting but with `odoo_product_id IS NULL`. Postgres partial-unique allows multiple NULLs.

### 3.4 Out of scope

We are NOT changing `odoo_id` semantics on other tables (`customers`, `suppliers`, `sale_orders`, etc.) in this plan. Those tables likely have the same template-vs-record issue but it has to be verified separately. **Defer to a follow-up.** This plan is product-focused because product was the discovered case.

---

## 4. Implementation steps

Each step is independently revertible. Each completes in < 5 minutes against prod data volumes.

### Step 1 — Schema migration (additive only)

New file: `supabase/migrations/20260423000001_products_odoo_ids_split.sql`

```sql
-- Add explicit columns for product.product.id and product.template.id from Odoo.
-- The legacy products.odoo_id column conflates the two; keep it for one release
-- so downstream code that still reads it doesn't break, then drop in a follow-up.

ALTER TABLE products
  ADD COLUMN odoo_product_id INT,
  ADD COLUMN odoo_template_id INT;

CREATE UNIQUE INDEX idx_products_odoo_product_id
  ON products(odoo_product_id)
  WHERE odoo_product_id IS NOT NULL;

CREATE INDEX idx_products_odoo_template_id
  ON products(odoo_template_id);

COMMENT ON COLUMN products.odoo_id IS
  'DEPRECATED 2026-04-23 — historical column that mixed product.product.id and product.template.id values. Use odoo_product_id (variant) or odoo_template_id (template). Will be dropped after verification.';
COMMENT ON COLUMN products.odoo_product_id IS
  'Foreign key to Odoo product.product.id (the variant). Unique when present.';
COMMENT ON COLUMN products.odoo_template_id IS
  'Foreign key to Odoo product.product.product_tmpl_id. Not unique — multivariant templates allowed.';
```

**Reversibility:** `DROP COLUMN odoo_product_id, odoo_template_id; DROP INDEX ...;` — no data loss because legacy `odoo_id` is untouched.

### Step 2 — Backfill from Odoo live

New file: `scripts/backfill_products_odoo_ids.py`

Pseudocode:

```
1. Auth to Odoo live (XML-RPC).
2. Fetch ALL product.product (active + archived) with fields:
     id, default_code, product_tmpl_id, active, write_date
3. Fetch ALL product.template (active + archived) with fields:
     id, default_code, name, product_variant_count
4. Pull all Supabase products: id, sku, odoo_id (legacy)
5. For each Supabase row, resolve odoo_product_id and odoo_template_id:
     case A — exact SKU match to exactly 1 active product.product:
        → use that p.id and p.product_tmpl_id
     case B — exact SKU match to multiple active product.product:
        → LOG WARNING with SKU, candidate IDs, names; do NOT update; require manual decision (§9 Q5)
     case C — exact SKU match to 0 active + 1 archived product.product:
        → use that archived p.id and its template id, set a flag in audit
     case D — no SKU match anywhere:
        → leave odoo_product_id NULL; record in orphans report
     case E — Supabase row has NULL sku:
        → leave both new columns NULL; record in null-sku report
6. Write resolutions in batches via PATCH.
7. Output two reports:
     - backfill_products_audit_<ts>.json (per-row resolution decision)
     - backfill_products_summary_<ts>.md (aggregated counts + warnings)
```

**Idempotency:** the script reads current state and updates only when needed. Re-runnable safely.

**Validation gate:** after running, must satisfy:
- `SELECT COUNT(*) FROM products WHERE odoo_product_id IS NOT NULL >= 1606` (1653 total − 18 SKU-orphan − 29 odoo-orphan)
- `SELECT COUNT(*) FROM products WHERE odoo_product_id IS NULL` ≤ 47 + null-sku rows
- 0 multivariant collisions silently picked

### Step 3 — Update `scripts/ingest.py`

Two paths possible, depending on Q1 in §9:

**Path A (recommended) — switch product ingest to live Odoo API.**

Replace [scripts/ingest.py:203-230 `load_products`](../../scripts/ingest.py) with a function that pulls `product.product` directly from Odoo and writes both `odoo_product_id` and `odoo_template_id`. This eliminates the misleading CSV path entirely.

**Path B (compat) — keep CSV ingest, fix what we read.**

If the CSV is truly meant to be `product.product` (filename suggests so), re-export from Odoo with the correct view (Sales → Products → action menu → Export, with "Export type: I want to update data" + checkbox "Include the active products" + select `id` field at variant level — Odoo 17 distinguishes). Update `load_products` to write `odoo_product_id` from the corrected CSV `ID` column AND derive `odoo_template_id` via a separate join CSV or live API.

Path A is enterprise-grade (single source of truth = Odoo live, no CSV drift). Path B preserves the offline-capable CSV pipeline.

### Step 4 — Update `ml/odoo_sync_oa_v2.py` SKU collision handling

Change [ml/odoo_sync_oa_v2.py:114-117](../../ml/odoo_sync_oa_v2.py) from:
```python
for p in odoo_products:
    sku = p.get('default_code')
    if sku:
        odoo_by_sku[sku] = p   # silent overwrite
```

to:
```python
by_sku = defaultdict(list)
for p in odoo_products:
    sku = p.get('default_code')
    if sku:
        by_sku[sku].append(p)

odoo_by_sku = {}
collisions = []
for sku, candidates in by_sku.items():
    actives = [p for p in candidates if p.get('active')]
    if len(actives) == 1:
        odoo_by_sku[sku] = actives[0]
    elif len(actives) > 1:
        collisions.append((sku, [p['id'] for p in actives]))
        # do NOT pick — require human decision
    elif len(candidates) == 1:
        odoo_by_sku[sku] = candidates[0]  # only archived option
    else:
        # multiple archived, no active — log and skip
        collisions.append((sku, [p['id'] for p in candidates]))

if collisions:
    logger.warning('SKU collisions, skipped %d SKUs: %s', len(collisions), collisions[:10])
    # write full list to audit file
```

### Step 5 — Defensive monitoring

Add a periodic check (e.g. via a `/scripts/audit_odoo_id_health.py` invoked nightly via cron or `/loop`):
- Count Supabase products with `odoo_product_id IS NULL AND sku IS NOT NULL` → alert if > 0
- Count SKUs in Odoo with multiple active variants → alert if > current baseline (2)
- Count Supabase SKUs not present in Odoo → alert if changes

Output goes to a Supabase `audit_log` table (already exists per [supabase/migrations/20260322000001_initial_schema.sql:46](../../supabase/migrations/20260322000001_initial_schema.sql)) so it's queryable from the app's admin panel.

### Step 6 — Drop legacy column (deferred)

After Steps 1-5 are stable for ≥1 week with no rollback:

```sql
ALTER TABLE products DROP COLUMN odoo_id;
```

Plus grep-and-remove all references to `products.odoo_id` in code (the 11 lines in `scripts/ingest.py` Step 3 already handles).

---

## 5. Test plan

### 5.1 Unit-level (against Odoo live + a throwaway Supabase project)

- Backfill script on a copy of prod → verify counts match the validation gate in Step 2.
- Re-run backfill → expect 0 changes (idempotent).
- Inject a fake multivariant SKU into the test Supabase → expect a logged warning, no silent pick.

### 5.2 Integration-level (prod-shaped, prod-paused)

Run the full sequence (migration → backfill → ingest test → sync test) against the actual prod Supabase **after** taking a manual `pg_dump` snapshot. Verify:
- Every existing app endpoint still returns the same data (smoke test the same RPCs the app uses).
- New columns are populated as expected.
- `/gerencia/validacion` still renders the same numbers as before the migration (since the SSOT pipeline doesn't depend on `odoo_id`).

### 5.3 Regression — SKU 77201046 specifically

Before/after backfill, confirm:
- `products` row for SKU 77201046 has `odoo_template_id = 9764` and `odoo_product_id = 7090`
- `demand_daily` aggregation for the product is unchanged
- `/api/gerencia/validacion?run_id=58` returns the same B value (6,361 for Nov 2024)

---

## 6. Rollout

1. **Day 0** — Apply migration (Step 1) to prod. Reversible. No app impact.
2. **Day 0** — Run backfill (Step 2) against prod. Read + PATCH only, no destructive ops. Audit reports archived locally.
3. **Day 1** — Manually review the multivariant collisions and the orphans audit. Decide per-row how to resolve (likely needs Luis input for 2 active-multi cases).
4. **Day 2** — Deploy `scripts/ingest.py` and `ml/odoo_sync_oa_v2.py` updates (Steps 3-4). New ingests now write all three columns correctly.
5. **Day 2-9** — Defensive monitoring (Step 5) running nightly. Verify no regressions.
6. **Day 10+** — Drop legacy `odoo_id` column (Step 6) once we're confident no caller uses it.

---

## 7. Risk register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Backfill picks wrong variant for a multivariant SKU | Low (only 2 SKUs at risk) | Wrong product associations downstream | Don't auto-resolve multivariant — require human decision |
| Migration adds columns that some unknown caller fails on | Very low | Caller breaks | Migration is purely additive — old code that selects `*` gets extra columns it ignores |
| Backfill update PATCHes accidentally rewrite SKUs | Very low | Data corruption | Backfill only writes `odoo_product_id`, `odoo_template_id`; never SKU or other fields |
| Dropping `odoo_id` breaks a caller we missed | Medium | App error | Use Step 6 deferral — wait 1 week of monitoring + grep audit before drop |
| Live Odoo schema differs from what we assume | Low | Backfill fails | Field names verified via [_ODOO_EXPLORATION_RESULTS.md](../../_ODOO_EXPLORATION_RESULTS.md) — `default_code`, `product_tmpl_id`, `active` all confirmed accessible |
| Re-running backfill gives different result on a SKU that drifted between runs | Possible | Last-write-wins on those rows | Audit log captures every change; can replay |

---

## 8. Backout

If anything goes wrong before Step 6:

```sql
ALTER TABLE products DROP COLUMN odoo_product_id;
ALTER TABLE products DROP COLUMN odoo_template_id;
DROP INDEX IF EXISTS idx_products_odoo_product_id;
DROP INDEX IF EXISTS idx_products_odoo_template_id;
```

`odoo_id` was never modified, so app behavior reverts to today's state.

After Step 6, backout requires restoring `odoo_id` column from the pg_dump taken at Step 2. Add explicit reminder in Step 6 tooling.

---

## 9. Open questions — decisions needed before execution

Per Rule 1, I need answers before writing code:

1. **Path A vs Path B for ingest** (§4 Step 3). API-only is cleaner long-term but requires Odoo live to be reachable from wherever ingest runs. CSV-based remains useful if the prod Supabase ingest needs to work offline or from a frozen export. Which?

2. **Multivariant resolution policy** for the 2 active-multi SKUs:
   - Option (a) Pick the variant with most recent `write_date` automatically.
   - Option (b) Pick the variant with most `sale.order.line` records automatically.
   - Option (c) Manual review with Luis — block backfill until resolved.
   I lean (c) since it's only 2 SKUs and silent auto-pick on real data conflicts with Rule 1.

3. **Orphan handling** for the 29 Supabase rows whose `odoo_id` matches nothing in current Odoo:
   - Option (a) Leave `odoo_product_id` NULL, mark `is_active=false` automatically.
   - Option (b) Investigate each (could be Odoo-side deletes, renames, or genuine ingest mistakes).
   I lean (b) — 29 is small enough to inspect by eye.

4. **The 2 internal Supabase SKU duplicates** — bug or intentional? If bug, which row is canonical? Resolving these before adding `sku UNIQUE` (§3.2) means `odoo_product_id UNIQUE` becomes redundant; not resolving means we keep both indexes.

5. **Apply same fix to other tables** (`customers`, `suppliers`, `warehouses`, etc.) — defer to follow-up plans, or include in scope? My recommendation: defer. This plan is already non-trivial; verify the same template-vs-record issue exists on those tables in a separate scope-check before planning fixes.

6. **Timing** — David demo is 2026-04-23 09:30 (today). Is this fix planned for today/this week, or is it a "before the live-sync milestone" piece?

---

## 10. Files this plan would create

| File | Purpose | When created |
|---|---|---|
| `supabase/migrations/20260423000001_products_odoo_ids_split.sql` | Step 1 migration | Step 1 execution |
| `scripts/backfill_products_odoo_ids.py` | Step 2 backfill | Step 2 execution |
| `scripts/audit_odoo_id_health.py` | Step 5 monitor | Step 5 execution |
| `docs/reconciliation/backfill_products_audit_<ts>.json` | Per-row backfill audit | Each backfill run |
| `docs/reconciliation/backfill_products_summary_<ts>.md` | Aggregated backfill report | Each backfill run |

This plan itself: [PLAN_FIX_PRODUCTS_ODOO_ID.md](PLAN_FIX_PRODUCTS_ODOO_ID.md)
Scope check that produced the numbers: [scope_check_odoo_id_bug.py](scope_check_odoo_id_bug.py) → [scope_check_odoo_id_bug_results.json](scope_check_odoo_id_bug_results.json) / [scope_check_odoo_id_bug_output.txt](scope_check_odoo_id_bug_output.txt)

---

## 11. What this plan deliberately does NOT do

- Does not change app-facing behavior. The app continues to work identically because no caller uses `products.odoo_id`.
- Does not touch other tables. `customers.odoo_id`, `suppliers.odoo_id`, etc. likely have the same issue but require their own scope check first.
- Does not build the live incremental sync ([_ODOO_EXPLORATION_PLAN.md](../../_ODOO_EXPLORATION_PLAN.md) Phase 3). It only makes the schema correct so that sync can be built without working around a broken FK.
- Does not auto-resolve any case where human judgment is needed (multivariant SKUs, orphans). Per Rule 1.
