"""
Step 0 audit — Forecast a Ciegas deep dive.

Runs four read-only substeps against Supabase prod:
  0a — Scope snapshot: 23 SKUs from products_acid_test_active (is_top_10_in_class).
  0b — revenue_daily coverage: MIN/MAX observation_date, per-month SUM(quantity)
        and non-zero-day count per SKU × metric.
  0c — forecast_results audit: model_status / yhat_sum / training_points per
        SKU × metric × forecast_month (latest training_end_date).
  0d — UoM audit: stock_uom + stock_uom_ratio per SKU, UoM homogeneity check.

Output: one findings markdown per substep in the same directory.

Nothing is mutated. Every query uses the anon-safe Supabase REST with the
service-role key loaded from .env.local / .env (same pattern as the existing
docs/reconciliation/find_*.py scripts).
"""
import os
import json
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite')
OUT_DIR = ROOT / 'docs/april_jumpstart/step0_audit'
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ------------------------------------------------------------ env + http
def load_env():
    for f in [ROOT / '.env.local', ROOT / '.env']:
        if not f.exists():
            continue
        for line in f.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                k, v = line.split('=', 1)
                k, v = k.strip(), v.strip()
                if k not in os.environ:
                    os.environ[k] = v


load_env()
SUPA = os.environ['NEXT_PUBLIC_SUPABASE_URL']
KEY = os.environ['SUPABASE_SECRET_KEY']


def supa_get(path, stable_order='id.asc'):
    """Paginated GET with a stable `order` clause (PostgREST offset pagination is
    only correct when a deterministic ORDER BY is provided). path should already
    include filters, NOT ?limit/?offset/?order."""
    rows = []
    page = 0
    PAGE_SIZE = 1000
    while True:
        sep = '&' if '?' in path else '?'
        paged = f"{path}{sep}order={stable_order}&limit={PAGE_SIZE}&offset={page * PAGE_SIZE}"
        req = urllib.request.Request(
            f"{SUPA}{paged}",
            headers={
                'apikey': KEY,
                'Authorization': f'Bearer {KEY}',
            },
            method='GET',
        )
        try:
            with urllib.request.urlopen(req) as r:
                batch = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"GET {paged} failed: HTTP {e.code}: {e.read().decode()[:500]}")
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        page += 1
        if page > 100:
            raise RuntimeError(f"pagination runaway on {path}")
    return rows


def fmt_num(n, digits=2):
    if n is None:
        return '—'
    return f"{float(n):,.{digits}f}"


def now_iso():
    return datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')


# ------------------------------------------------------------ 0a scope
def substep_0a():
    print("[0a] Fetching 23 acid-test SKUs…")
    rows = supa_get(
        '/rest/v1/products_acid_test_active'
        '?is_top_10_in_class=eq.true'
        '&select=default_code,representative_name,supplier_class,source_indicator,'
        'movement_rank_within_class,net_sales_quantity,net_sales_revenue_gtq,'
        'product_template_id,product_product_ids'
        '&order=supplier_class.asc,movement_rank_within_class.asc'
    )

    # Cross-reference to our products table (SKU → odoo_id, stock_uom, stock_uom_ratio)
    skus = [r['default_code'] for r in rows if r.get('default_code')]
    products = []
    if skus:
        sku_in = ','.join(f'"{s}"' for s in skus)
        products = supa_get(
            f'/rest/v1/products?sku=in.({sku_in})'
            '&select=id,sku,name,stock_uom,stock_uom_ratio,odoo_id,is_active'
        )
    sku_to_prod = {p['sku']: p for p in products}

    # Merge
    enriched = []
    for r in rows:
        sku = r.get('default_code')
        prod = sku_to_prod.get(sku, {})
        enriched.append({
            **r,
            'supabase_product_id': prod.get('id'),
            'supabase_odoo_id': prod.get('odoo_id'),
            'supabase_stock_uom': prod.get('stock_uom'),
            'supabase_stock_uom_ratio': prod.get('stock_uom_ratio'),
            'supabase_is_active': prod.get('is_active'),
        })

    # Persist JSON for downstream substeps
    (OUT_DIR / '_0a_scope.json').write_text(json.dumps(enriched, indent=2, default=str))

    # Markdown findings
    md = []
    md.append("# Step 0a — Scope Snapshot\n")
    md.append(f"**Run:** {now_iso()}\n")
    md.append(f"**Count:** {len(enriched)} SKUs (`is_top_10_in_class=true`)\n\n")
    md.append("## Scope table\n")
    md.append("| # | default_code | class | rank | source | representative_name | supa product_id | stock_uom | ratio | active |")
    md.append("|---|---|---|---|---|---|---|---|---|---|")
    for i, r in enumerate(enriched, 1):
        md.append(
            f"| {i} | `{r.get('default_code') or '—'}` | {r.get('supplier_class')} | "
            f"{r.get('movement_rank_within_class')} | {r.get('source_indicator')} | "
            f"{(r.get('representative_name') or '')[:50]} | "
            f"{r.get('supabase_product_id') or '—'} | "
            f"{r.get('supabase_stock_uom') or '—'} | "
            f"{fmt_num(r.get('supabase_stock_uom_ratio'), 4)} | "
            f"{r.get('supabase_is_active')} |"
        )

    # Observations
    missing_in_supa = [r for r in enriched if r.get('supabase_product_id') is None]
    classes = defaultdict(int)
    uoms = defaultdict(list)
    for r in enriched:
        classes[r.get('supplier_class')] += 1
        if r.get('supabase_stock_uom'):
            uoms[r['supabase_stock_uom']].append(r.get('default_code'))

    md.append("\n## Observations\n")
    md.append(f"- **Class breakdown:** {dict(classes)}")
    md.append(f"- **SKUs missing from Supabase `products` table:** {len(missing_in_supa)}")
    if missing_in_supa:
        md.append("  - " + ", ".join(f"`{m.get('default_code')}`" for m in missing_in_supa))
    md.append(f"- **Distinct stock UoMs in scope:** {len(uoms)} — {dict((k, len(v)) for k, v in uoms.items())}")

    md.append("\n## Distinct UoMs\n")
    md.append("| stock_uom | SKU count | SKUs |")
    md.append("|---|---|---|")
    for uom, sku_list in sorted(uoms.items(), key=lambda kv: -len(kv[1])):
        shown = ", ".join(f"`{s}`" for s in sku_list[:10])
        if len(sku_list) > 10:
            shown += f", … (+{len(sku_list) - 10} more)"
        md.append(f"| `{uom}` | {len(sku_list)} | {shown} |")

    md.append("\n## Insights\n")
    if len(uoms) > 1:
        md.append(
            "- **Cross-UoM aggregation in the existing Forecast a Ciegas total row is UNSAFE** "
            "per §3 UoM policy (multiple distinct stock UoMs in scope). This must be remediated "
            "before the demo or moved to a ratio/index view."
        )
    else:
        md.append(
            f"- All 23 SKUs share a single stock UoM (`{list(uoms)[0] if uoms else '—'}`). "
            "Cross-SKU sum is UoM-safe."
        )
    if missing_in_supa:
        md.append(
            f"- **{len(missing_in_supa)} scope SKU(s) are absent from the Supabase `products` table**. "
            "Forecast pipeline maps SKU → products.id to resolve product_id for `forecast_results`. "
            "Absent rows cannot be forecast at all → confirmed structural cause for any 'missing forecast' complaint on these SKUs."
        )

    (OUT_DIR / '0a_scope_findings.md').write_text("\n".join(md) + "\n")
    print(f"[0a] Wrote 0a_scope_findings.md ({len(enriched)} SKUs, {len(uoms)} UoMs)")
    return enriched


# ------------------------------------------------------------ 0b revenue_daily coverage
def substep_0b(scope):
    print("[0b] Auditing revenue_daily coverage…")
    product_ids = sorted({r['supabase_product_id'] for r in scope if r.get('supabase_product_id')})
    if not product_ids:
        (OUT_DIR / '0b_revenue_daily_findings.md').write_text(
            "# Step 0b — revenue_daily coverage\n\nNo scope product_ids resolved; skip.\n"
        )
        return

    pid_in = ','.join(str(p) for p in product_ids)
    rows = supa_get(
        f'/rest/v1/revenue_daily'
        f'?product_id=in.({pid_in})'
        '&select=product_id,ssot_label,metric,observation_date,quantity'
    )
    print(f"[0b] revenue_daily rows fetched: {len(rows):,}")

    # Aggregate: per (product_id, metric) → list of (date, qty)
    agg = defaultdict(lambda: defaultdict(list))  # [(product_id, metric)][month] = [qty, ...]
    total_per_cell = defaultdict(lambda: {'n_rows': 0, 'min_date': None, 'max_date': None,
                                           'nonzero_days': 0, 'total_qty': 0.0,
                                           'ssot_labels': set()})
    for r in rows:
        pid = r['product_id']
        metric = r['metric']
        obs = r['observation_date']
        qty = float(r['quantity'] or 0)
        month = obs[:7]
        agg[(pid, metric)][month].append(qty)
        cell = total_per_cell[(pid, metric)]
        cell['n_rows'] += 1
        cell['total_qty'] += qty
        if qty != 0:
            cell['nonzero_days'] += 1
        cell['ssot_labels'].add(r['ssot_label'])
        if cell['min_date'] is None or obs < cell['min_date']:
            cell['min_date'] = obs
        if cell['max_date'] is None or obs > cell['max_date']:
            cell['max_date'] = obs

    # Global min/max
    all_dates = [r['observation_date'] for r in rows]
    global_min = min(all_dates) if all_dates else None
    global_max = max(all_dates) if all_dates else None

    # Persist JSON summary
    summary = {
        'n_rows': len(rows),
        'n_product_ids_in_scope': len(product_ids),
        'global_min_date': global_min,
        'global_max_date': global_max,
        'per_cell': {
            f"{pid}|{metric}": {
                **{k: (v if not isinstance(v, set) else sorted(v)) for k, v in cell.items()},
            }
            for (pid, metric), cell in total_per_cell.items()
        },
    }
    (OUT_DIR / '_0b_revenue_daily.json').write_text(json.dumps(summary, indent=2, default=str))

    # Markdown
    md = []
    md.append("# Step 0b — revenue_daily Coverage Audit\n")
    md.append(f"**Run:** {now_iso()}\n")
    md.append(f"**Scope product_ids:** {len(product_ids)}\n")
    md.append(f"**Total rows:** {len(rows):,}\n")
    md.append(f"**Global date range:** {global_min} → {global_max}\n\n")

    # Per-SKU × metric summary
    sku_by_pid = {r['supabase_product_id']: r for r in scope if r.get('supabase_product_id')}
    metrics = ['sales', 'purchases_ordered', 'purchases_received']

    md.append("## Per-SKU × metric summary\n")
    md.append("| SKU | class | metric | min_date | max_date | n_rows | nonzero_days | total_qty | n_ssot |")
    md.append("|---|---|---|---|---|---|---|---|---|")
    for pid in product_ids:
        meta = sku_by_pid.get(pid, {})
        for metric in metrics:
            cell = total_per_cell.get((pid, metric))
            if not cell:
                md.append(
                    f"| `{meta.get('default_code','?')}` | {meta.get('supplier_class','?')} | "
                    f"{metric} | — | — | **0** | 0 | 0 | 0 |"
                )
                continue
            md.append(
                f"| `{meta.get('default_code','?')}` | {meta.get('supplier_class','?')} | "
                f"{metric} | {cell['min_date']} | {cell['max_date']} | "
                f"{cell['n_rows']:,} | {cell['nonzero_days']:,} | {fmt_num(cell['total_qty'])} | "
                f"{len(cell['ssot_labels'])} |"
            )

    # January 2026 coverage specifically (the H0c/H4 canary)
    md.append("\n## January 2026 coverage (H0c / H4 canary)\n")
    md.append("Did `revenue_daily` collect data through 2026-01-31 for every SKU × metric?\n")
    md.append("| SKU | metric | max observation_date in Jan 2026 | Jan 2026 rows | Jan 2026 nonzero days |")
    md.append("|---|---|---|---|---|")
    jan_counts = defaultdict(lambda: {'max': None, 'rows': 0, 'nz': 0})
    for r in rows:
        if not r['observation_date'].startswith('2026-01'):
            continue
        key = (r['product_id'], r['metric'])
        jan = jan_counts[key]
        jan['rows'] += 1
        if float(r['quantity'] or 0) != 0:
            jan['nz'] += 1
        if jan['max'] is None or r['observation_date'] > jan['max']:
            jan['max'] = r['observation_date']
    for pid in product_ids:
        meta = sku_by_pid.get(pid, {})
        for metric in metrics:
            j = jan_counts.get((pid, metric), {})
            md.append(
                f"| `{meta.get('default_code','?')}` | {metric} | "
                f"{j.get('max') or '—'} | {j.get('rows', 0)} | {j.get('nz', 0)} |"
            )

    # Insights
    missing_cells = []
    late_cutoff = []
    sparse_cells = []
    for pid in product_ids:
        for metric in metrics:
            cell = total_per_cell.get((pid, metric))
            sku = sku_by_pid.get(pid, {}).get('default_code', '?')
            if not cell or cell['n_rows'] == 0:
                missing_cells.append((sku, metric))
                continue
            if cell['max_date'] is None or cell['max_date'] < '2026-01-15':
                late_cutoff.append((sku, metric, cell['max_date']))
            if cell['nonzero_days'] < 10:
                sparse_cells.append((sku, metric, cell['nonzero_days']))

    md.append("\n## Insights\n")
    md.append(f"- **Cells with zero rows in `revenue_daily`:** {len(missing_cells)}")
    if missing_cells:
        md.append("  - " + ", ".join(f"`{s}`/{m}" for s, m in missing_cells[:10]))
        if len(missing_cells) > 10:
            md.append(f"  - … (+{len(missing_cells) - 10} more)")
    md.append(f"- **Cells whose max observation_date < 2026-01-15 (potential sync cutoff):** {len(late_cutoff)}")
    if late_cutoff:
        for s, m, d in late_cutoff[:10]:
            md.append(f"  - `{s}`/{m} — max date {d}")
    md.append(
        f"- **Cells with < 10 non-zero days total (Prophet `insufficient_history` gate triggers at this level):** "
        f"{len(sparse_cells)}"
    )
    if sparse_cells:
        for s, m, n in sparse_cells[:15]:
            md.append(f"  - `{s}`/{m} — {n} non-zero days")

    md.append("\n## Possibilities this evidence supports\n")
    if missing_cells:
        md.append(
            f"- **H0a (placeholder row):** confirmed plausible — {len(missing_cells)} cells have no "
            "training data at all, so the forecast pipeline would write an `insufficient_history` "
            "placeholder row (yhat_sum=0) for each."
        )
    if late_cutoff:
        md.append(
            f"- **H0c (late-period collapse):** confirmed plausible — {len(late_cutoff)} cells' "
            "last data point is before Jan 15 2026, meaning the training window through Jan 31 "
            "reindexes the last 2+ weeks as zero."
        )
    if sparse_cells:
        md.append(
            f"- **H0a via the `nonzero_points < 10` gate:** confirmed plausible — "
            f"{len(sparse_cells)} cells have fewer than 10 non-zero training days total, which "
            "trips the `insufficient_history` branch in the run route."
        )

    (OUT_DIR / '0b_revenue_daily_findings.md').write_text("\n".join(md) + "\n")
    print(f"[0b] Wrote 0b_revenue_daily_findings.md")


# ------------------------------------------------------------ 0c forecast_results
def substep_0c(scope):
    print("[0c] Auditing forecast_results…")
    product_ids = sorted({r['supabase_product_id'] for r in scope if r.get('supabase_product_id')})
    if not product_ids:
        (OUT_DIR / '0c_forecast_results_findings.md').write_text(
            "# Step 0c — forecast_results\n\nNo scope product_ids resolved; skip.\n"
        )
        return

    pid_in = ','.join(str(p) for p in product_ids)
    rows = supa_get(
        f'/rest/v1/forecast_results'
        f'?product_id=in.({pid_in})'
        '&select=product_id,ssot_label,metric,forecast_month,training_end_date,'
        'yhat_sum,yhat_lower_sum,yhat_upper_sum,training_points,nonzero_points,model_status,computed_at'
    )
    print(f"[0c] forecast_results rows fetched: {len(rows):,}")

    # Keep latest training_end_date per (product, metric, forecast_month)
    latest = {}
    for r in rows:
        key = (r['product_id'], r['metric'], r['forecast_month'])
        prior = latest.get(key)
        if prior is None or r['training_end_date'] > prior['training_end_date']:
            latest[key] = r

    (OUT_DIR / '_0c_forecast_results.json').write_text(
        json.dumps(list(latest.values()), indent=2, default=str)
    )

    md = []
    md.append("# Step 0c — forecast_results Audit\n")
    md.append(f"**Run:** {now_iso()}\n")
    md.append(f"**Scope product_ids:** {len(product_ids)}\n")
    md.append(f"**Total rows (all snapshots):** {len(rows):,}\n")
    md.append(f"**Latest snapshots:** {len(latest):,}\n\n")

    # Status counts
    status_counts = defaultdict(int)
    status_by_sku = defaultdict(lambda: defaultdict(int))
    sku_by_pid = {r['supabase_product_id']: r for r in scope if r.get('supabase_product_id')}
    for r in latest.values():
        status_counts[r['model_status']] += 1
        sku = sku_by_pid.get(r['product_id'], {}).get('default_code', f'pid={r["product_id"]}')
        status_by_sku[sku][r['model_status']] += 1

    md.append("## Status distribution across latest snapshots\n")
    md.append("| model_status | cells |")
    md.append("|---|---|")
    for s, n in sorted(status_counts.items(), key=lambda kv: -kv[1]):
        md.append(f"| `{s}` | {n} |")

    # Per SKU table: status counts for Feb + Mar 2026 per metric
    md.append("\n## Feb + Mar 2026 status per SKU × metric (latest snapshot)\n")
    md.append("| SKU | class | metric | Feb status | Feb yhat_sum | Feb nonzero | Mar status | Mar yhat_sum | Mar nonzero |")
    md.append("|---|---|---|---|---|---|---|---|---|")
    metrics = ['sales', 'purchases_ordered', 'purchases_received']
    for pid in product_ids:
        meta = sku_by_pid.get(pid, {})
        for metric in metrics:
            feb = latest.get((pid, metric, '2026-02-01'))
            mar = latest.get((pid, metric, '2026-03-01'))
            md.append(
                f"| `{meta.get('default_code','?')}` | {meta.get('supplier_class','?')} | "
                f"{metric} | "
                f"{feb['model_status'] if feb else '—'} | "
                f"{fmt_num(feb['yhat_sum']) if feb else '—'} | "
                f"{feb['nonzero_points'] if feb else '—'} | "
                f"{mar['model_status'] if mar else '—'} | "
                f"{fmt_num(mar['yhat_sum']) if mar else '—'} | "
                f"{mar['nonzero_points'] if mar else '—'} |"
            )

    # Smallest yhat_sum cells (H0a smoking gun)
    ok_cells = [r for r in latest.values() if r['model_status'] == 'ok']
    nok_cells = [r for r in latest.values() if r['model_status'] != 'ok']
    tiny = sorted(ok_cells, key=lambda r: float(r['yhat_sum'] or 0))[:20]

    md.append("\n## 20 smallest yhat_sum cells with status=ok (H0a / H0c candidates)\n")
    md.append("| SKU | metric | month | yhat_sum | training_points | nonzero_points |")
    md.append("|---|---|---|---|---|---|")
    for r in tiny:
        sku = sku_by_pid.get(r['product_id'], {}).get('default_code', f"pid={r['product_id']}")
        md.append(
            f"| `{sku}` | {r['metric']} | {r['forecast_month']} | "
            f"{fmt_num(r['yhat_sum'])} | {r['training_points']} | {r['nonzero_points']} |"
        )

    md.append(f"\n## Cells with status != 'ok' (placeholder rows — H0a confirmation)\n")
    md.append(f"**Count:** {len(nok_cells)}\n")
    if nok_cells:
        md.append("| SKU | metric | month | status | yhat_sum | training_points | nonzero_points |")
        md.append("|---|---|---|---|---|---|---|")
        for r in nok_cells:
            sku = sku_by_pid.get(r['product_id'], {}).get('default_code', f"pid={r['product_id']}")
            md.append(
                f"| `{sku}` | {r['metric']} | {r['forecast_month']} | "
                f"`{r['model_status']}` | {fmt_num(r['yhat_sum'])} | "
                f"{r['training_points']} | {r['nonzero_points']} |"
            )

    # Insights
    md.append("\n## Insights & possibilities\n")
    if 'insufficient_history' in status_counts or 'training_failed' in status_counts:
        md.append(
            f"- **H0a confirmed (structural placeholder rows present):** "
            f"{status_counts.get('insufficient_history', 0)} `insufficient_history` + "
            f"{status_counts.get('training_failed', 0)} `training_failed` rows live in `forecast_results`. "
            "The forecast read-endpoint does NOT filter by model_status, so the Forecast a Ciegas UI "
            "renders these as yhat_sum (0) alongside real forecasts."
        )
    else:
        md.append("- **H0a ruled out at the `model_status` level** — every cell trained successfully.")

    missing_feb = []
    missing_mar = []
    for pid in product_ids:
        for metric in metrics:
            if (pid, metric, '2026-02-01') not in latest:
                missing_feb.append((sku_by_pid.get(pid, {}).get('default_code', '?'), metric))
            if (pid, metric, '2026-03-01') not in latest:
                missing_mar.append((sku_by_pid.get(pid, {}).get('default_code', '?'), metric))
    md.append(f"- **Cells with no Feb 2026 row:** {len(missing_feb)} "
              f"(matches the placeholder-month code-path — placeholders collapse both Feb+Mar into Mar)")
    if missing_feb:
        md.append("  - " + ", ".join(f"`{s}`/{m}" for s, m in missing_feb[:10]))
    md.append(f"- **Cells with no Mar 2026 row:** {len(missing_mar)}")
    if missing_mar:
        md.append("  - " + ", ".join(f"`{s}`/{m}" for s, m in missing_mar[:10]))

    if tiny:
        smallest = tiny[0]
        sku0 = sku_by_pid.get(smallest['product_id'], {}).get('default_code', '?')
        md.append(
            f"- **Smallest OK-status forecast:** `{sku0}` / {smallest['metric']} / "
            f"{smallest['forecast_month']} = **{fmt_num(smallest['yhat_sum'])}**. "
            "If any cell here is near the insider's '200' figure, this is the Quote 2 smoking gun."
        )

    (OUT_DIR / '0c_forecast_results_findings.md').write_text("\n".join(md) + "\n")
    print(f"[0c] Wrote 0c_forecast_results_findings.md")


# ------------------------------------------------------------ 0d UoM audit
def substep_0d(scope):
    print("[0d] Auditing UoMs…")
    md = []
    md.append("# Step 0d — UoM Audit\n")
    md.append(f"**Run:** {now_iso()}\n\n")
    md.append(
        "Per §3 of the plan, cross-SKU aggregation in absolute quantity is only "
        "safe when all SKUs share a stock UoM. This substep enumerates what each "
        "of the 23 acid-test SKUs carries in Supabase's `products` table.\n"
    )

    md.append("## Per-SKU UoM\n")
    md.append("| SKU | class | representative_name | stock_uom | stock_uom_ratio | supabase_odoo_id | supabase_active |")
    md.append("|---|---|---|---|---|---|---|")

    uom_set = defaultdict(list)
    missing = []
    for r in scope:
        sku = r.get('default_code') or '?'
        if not r.get('supabase_product_id'):
            missing.append(sku)
            md.append(
                f"| `{sku}` | {r.get('supplier_class')} | "
                f"{(r.get('representative_name') or '')[:50]} | "
                f"**NOT IN SUPABASE** | — | — | — |"
            )
            continue
        uom = r.get('supabase_stock_uom') or 'NULL'
        uom_set[uom].append(sku)
        md.append(
            f"| `{sku}` | {r.get('supplier_class')} | "
            f"{(r.get('representative_name') or '')[:50]} | "
            f"`{uom}` | {fmt_num(r.get('supabase_stock_uom_ratio'), 4)} | "
            f"{r.get('supabase_odoo_id') or '—'} | "
            f"{r.get('supabase_is_active')} |"
        )

    md.append("\n## Distinct UoM bucket distribution\n")
    md.append("| stock_uom | SKU count | SKUs |")
    md.append("|---|---|---|")
    for uom, sku_list in sorted(uom_set.items(), key=lambda kv: -len(kv[1])):
        md.append(f"| `{uom}` | {len(sku_list)} | " + ", ".join(f"`{s}`" for s in sku_list) + " |")

    md.append("\n## Insights & possibilities\n")
    if len(uom_set) == 0:
        md.append("- Scope empty after Supabase filter — nothing to evaluate.")
    elif len(uom_set) == 1:
        md.append(
            f"- **All in-Supabase scope SKUs share `{list(uom_set)[0]}`** — cross-SKU absolute-quantity "
            "sum is UoM-safe. The existing Forecast a Ciegas total row is UoM-safe. "
            "This rules out H0b as a root cause for the 200× miss **at the scope-level total**; "
            "H0b can still apply at the individual-SKU level if `revenue_daily.quantity` was "
            "converted wrong for some SKU during ingestion (verified by H0c / step 0b evidence)."
        )
    else:
        md.append(
            f"- **Scope contains {len(uom_set)} distinct stock UoMs.** Per §3 policy, cross-SKU "
            "absolute-quantity sums are NOT safe here. The existing Forecast a Ciegas total row is "
            f"mathematically meaningless until remediated. UoM groups: "
            + ", ".join(f"`{u}` ({len(ss)})" for u, ss in uom_set.items()) + "."
        )
    if missing:
        md.append(
            f"- **{len(missing)} scope SKU(s) have no row in Supabase `products` at all.** "
            "These SKUs cannot be forecast (forecast pipeline joins on products.id). Any forecast "
            "for these SKUs in the UI is either absent or rendering something from a stale row."
            + " Missing: " + ", ".join(f"`{s}`" for s in missing[:10])
        )
    md.append(
        "\n**Out-of-scope for this step (to be answered by future work):** whether `stock_uom` "
        "is in fact the Odoo `uom_id` name string (e.g. `CAJA40`) or a display-level name, and "
        "whether `stock_uom_ratio` correctly reflects the Odoo `uom.uom.factor` or is a no-op `1.0`. "
        "A future Odoo-side audit (using the explorer in `ml/odoo_explorer.py`) can compare."
    )

    (OUT_DIR / '0d_uom_findings.md').write_text("\n".join(md) + "\n")
    print(f"[0d] Wrote 0d_uom_findings.md")


# ------------------------------------------------------------ main
if __name__ == '__main__':
    scope = substep_0a()
    substep_0b(scope)
    substep_0c(scope)
    substep_0d(scope)
    print("\nAll substeps complete.")
    print(f"Findings written to: {OUT_DIR}")
