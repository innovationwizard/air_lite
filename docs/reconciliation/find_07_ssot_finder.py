"""
Step 2 — Brute-force SSOT finder for SKU 77201046.

Target ground truth (from David's transcript / CEO Luis's dashboard):
  Sales Nov 2024 = 6466.25
  Sales Dec 2024 = 6496.50
  Purchases Nov 2024 ordered  = 5917
  Purchases Nov 2024 received = 5500
  Purchases all-time total    = 8203

Inputs:
  - odoo_extract_77201046_latest.json          (sale.order.line, purchase.order.line, stock.move, parents)
  - odoo_extract_77201046_invoices_latest.json (account.move.line, account.move, account.account)
  - uom.uom records for normalization (in the first extract)

Strategy:
  Enumerate plausible filter combinations across multiple source tables.
  For each, compute the 5 anchor metrics, score by sum of absolute gaps.
  Output top-50 ranked + persist all results JSON for audit.
"""
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation')
EXTRACT_OPS = ROOT / 'odoo_extract_77201046_latest.json'
EXTRACT_INV = ROOT / 'odoo_extract_77201046_invoices_latest.json'
OUT_MD = ROOT / 'find_07_ssot_finder_results.md'
OUT_JSON = ROOT / 'find_07_ssot_finder_results.json'

VARIANT_IDS = [7090, 1541, 2371]
TARGET = {
    'sales_nov2024': 6466.25,
    'sales_dec2024': 6496.50,
    'purchases_nov2024_ordered': 5917,
    'purchases_nov2024_received': 5500,
    'purchases_all_time_total': 8203,
}

ops = json.loads(EXTRACT_OPS.read_text())
inv = json.loads(EXTRACT_INV.read_text())

print(f"Loaded ops extract: sale_order_line={len(ops['sale_order_line'])}, "
      f"purchase_order_line={len(ops['purchase_order_line'])}, stock_move={len(ops['stock_move'])}")
print(f"Loaded inv extract: account_move_line={len(inv['account_move_line'])}, "
      f"account_move={len(inv['account_move'])}, account_account={len(inv['account_account'])}")

# Index parents
so_by_id = {o['id']: o for o in ops['sale_order']}
po_by_id = {o['id']: o for o in ops['purchase_order']}
move_by_id = {m['id']: m for m in inv['account_move']}
acct_by_id = {a['id']: a for a in inv['account_account']}

# UoM ratios (factor)
uom_by_id = {u['id']: u for u in ops['uom_uom']}
def uom_factor(uid):
    """Odoo factor: how many of THIS UoM = 1 reference. To convert qty in UoM X to ref: qty / factor_X.
    Then convert ref to CAJA40: qty_ref / factor_CAJA40 * factor_ref ... actually:
    cross-conversion: qty_target = qty_source * factor_target / factor_source"""
    return uom_by_id.get(uid, {}).get('factor', 1.0)

CAJA40_FACTOR = None
for u in ops['uom_uom']:
    if u['name'] == 'CAJA40':
        CAJA40_FACTOR = u['factor']
        break
assert CAJA40_FACTOR, "CAJA40 not found in uom.uom"
print(f"CAJA40 factor: {CAJA40_FACTOR}")

def to_caja40(qty, uom_id):
    """Convert qty in given uom_id to CAJA40 units."""
    if not uom_id:
        return qty
    f_src = uom_factor(uom_id)
    if not f_src or f_src == 0:
        return qty
    return qty * CAJA40_FACTOR / f_src

def month_key(date_str):
    if not date_str: return None
    return date_str[:7]


# ==========================================================================
# SALES candidate formulas
# ==========================================================================

def compute_aml_sales(month, *,
                     account_types=('income',),
                     move_states=('posted',),
                     move_types=('out_invoice',),
                     date_field='invoice_date',
                     refund_negative=False,
                     normalize_uom=False,
                     variant_filter=None):
    """Aggregate account.move.line for SKU 77201046 with given filters."""
    total = 0.0
    for l in inv['account_move_line']:
        # Variant filter
        if variant_filter is not None:
            pid = l['product_id'][0] if l.get('product_id') else None
            if pid not in variant_filter:
                continue
        # Account filter
        acct = acct_by_id.get(l['account_id'][0]) if l.get('account_id') else None
        if not acct or acct.get('account_type') not in account_types:
            continue
        m = move_by_id.get(l['move_id'][0]) if l.get('move_id') else None
        if not m: continue
        if m.get('state') not in move_states:
            continue
        if move_types and m.get('move_type') not in move_types:
            continue
        # Date
        if date_field == 'invoice_date':
            d = m.get('invoice_date') or m.get('date')
        elif date_field == 'date':
            d = m.get('date')
        elif date_field == 'aml_date':
            d = l.get('date')
        else:
            d = m.get(date_field)
        if month_key(d) != month:
            continue
        qty = float(l.get('quantity') or 0)
        if normalize_uom:
            uid = l['product_uom_id'][0] if l.get('product_uom_id') else None
            qty = to_caja40(qty, uid)
        if refund_negative and m.get('move_type') == 'out_refund':
            qty = -qty
        total += qty
    return round(total, 4)


def compute_sol_sales(month, *,
                     date_field='effective_date',
                     qty_field='qty_delivered',
                     so_states=('sale', 'done'),
                     require_delivered_gt0=True,
                     normalize_uom=False,
                     variant_filter=None,
                     fallback_date=None):
    """Aggregate sale.order.line."""
    total = 0.0
    for l in ops['sale_order_line']:
        if variant_filter is not None:
            pid = l['product_id'][0] if l.get('product_id') else None
            if pid not in variant_filter:
                continue
        o = so_by_id.get(l['order_id'][0]) if l.get('order_id') else None
        if not o: continue
        if so_states and o.get('state') not in so_states:
            continue
        dq = float(l.get('qty_delivered') or 0)
        if require_delivered_gt0 and dq <= 0:
            continue
        d = o.get(date_field)
        if not d and fallback_date:
            d = o.get(fallback_date)
        if month_key(d) != month:
            continue
        if qty_field == 'qty_delivered':
            qty = dq
        elif qty_field == 'product_uom_qty':
            qty = float(l.get('product_uom_qty') or 0)
        elif qty_field == 'qty_invoiced':
            qty = float(l.get('qty_invoiced') or 0)
        else:
            qty = 0
        if normalize_uom:
            uid = l['product_uom'][0] if l.get('product_uom') else None
            qty = to_caja40(qty, uid)
        total += qty
    return round(total, 4)


# ==========================================================================
# PURCHASE candidate formulas
# ==========================================================================

def compute_pol_purchases(month, *,
                          qty_field='product_qty',
                          po_states=('purchase', 'done'),
                          date_field='date_order',
                          normalize_uom=False,
                          variant_filter=None,
                          all_time=False):
    """Aggregate purchase.order.line."""
    total = 0.0
    for l in ops['purchase_order_line']:
        if variant_filter is not None:
            pid = l['product_id'][0] if l.get('product_id') else None
            if pid not in variant_filter:
                continue
        o = po_by_id.get(l['order_id'][0]) if l.get('order_id') else None
        if not o: continue
        if po_states and o.get('state') not in po_states:
            continue
        if not all_time:
            d = o.get(date_field)
            if month_key(d) != month:
                continue
        if qty_field == 'product_qty':
            qty = float(l.get('product_qty') or 0)
        elif qty_field == 'qty_received':
            qty = float(l.get('qty_received') or 0)
        elif qty_field == 'qty_invoiced':
            qty = float(l.get('qty_invoiced') or 0)
        else:
            qty = 0
        if normalize_uom:
            uid = l['product_uom'][0] if l.get('product_uom') else None
            qty = to_caja40(qty, uid)
        total += qty
    return round(total, 4)


def compute_aml_purchases(month, *,
                         account_types=('expense_direct_cost',),
                         move_states=('posted',),
                         move_types=('in_invoice',),
                         date_field='invoice_date',
                         refund_negative=False,
                         normalize_uom=False,
                         variant_filter=None,
                         all_time=False):
    """Aggregate account.move.line for purchases."""
    total = 0.0
    for l in inv['account_move_line']:
        if variant_filter is not None:
            pid = l['product_id'][0] if l.get('product_id') else None
            if pid not in variant_filter:
                continue
        acct = acct_by_id.get(l['account_id'][0]) if l.get('account_id') else None
        if not acct or acct.get('account_type') not in account_types:
            continue
        m = move_by_id.get(l['move_id'][0]) if l.get('move_id') else None
        if not m: continue
        if m.get('state') not in move_states:
            continue
        if move_types and m.get('move_type') not in move_types:
            continue
        if not all_time:
            if date_field == 'invoice_date':
                d = m.get('invoice_date') or m.get('date')
            else:
                d = m.get(date_field)
            if month_key(d) != month:
                continue
        qty = float(l.get('quantity') or 0)
        if normalize_uom:
            uid = l['product_uom_id'][0] if l.get('product_uom_id') else None
            qty = to_caja40(qty, uid)
        if refund_negative and m.get('move_type') == 'in_refund':
            qty = -qty
        total += qty
    return round(total, 4)


def compute_stockmove_purchases_received(month, *,
                                          variant_filter=None,
                                          normalize_uom=True,
                                          all_time=False):
    """stock.move where vendor → internal location, state=done."""
    total = 0.0
    for sm in ops['stock_move']:
        if variant_filter is not None:
            pid = sm['product_id'][0] if sm.get('product_id') else None
            if pid not in variant_filter:
                continue
        if sm.get('state') != 'done':
            continue
        # We don't have full location.usage info in stock.move; rely on origin
        origin = (sm.get('origin') or '').upper()
        if not origin.startswith('PO-'):
            continue
        if not all_time:
            if month_key(sm.get('date')) != month:
                continue
        qty = float(sm.get('quantity') or 0)
        if normalize_uom:
            uid = sm['product_uom'][0] if sm.get('product_uom') else None
            qty = to_caja40(qty, uid)
        total += qty
    return round(total, 4)


# ==========================================================================
# Build candidate matrices
# ==========================================================================

VARIANT_SUBSETS = {
    'all_3_variants': set(VARIANT_IDS),
    'active_only_7090': {7090},
    'all_except_archived_2371': {7090, 1541},
}

# ----- SALES candidates -----
sales_candidates = []

# A) account.move.line variants
aml_account_combos = [
    {'account_types': ('income',), 'label': 'income'},
    {'account_types': ('income', 'income_other'), 'label': 'income+income_other'},
]
aml_state_combos = [
    {'move_states': ('posted',), 'label': 'posted'},
    {'move_states': ('posted', 'draft'), 'label': 'posted+draft'},
]
aml_type_combos = [
    {'move_types': ('out_invoice',), 'refund_negative': False, 'label': 'invoice_only'},
    {'move_types': ('out_invoice', 'out_refund'), 'refund_negative': True, 'label': 'invoice_refund_neg'},
    {'move_types': ('out_invoice', 'out_refund'), 'refund_negative': False, 'label': 'invoice_refund_pos'},
    {'move_types': None, 'refund_negative': False, 'label': 'all_move_types'},
]
aml_date_combos = [
    {'date_field': 'invoice_date', 'label': 'invoice_date'},
    {'date_field': 'date', 'label': 'move.date'},
    {'date_field': 'aml_date', 'label': 'aml.date'},
]
aml_norm_combos = [
    {'normalize_uom': True, 'label': 'norm_C40'},
    {'normalize_uom': False, 'label': 'raw'},
]
for vname, vset in VARIANT_SUBSETS.items():
    for ac in aml_account_combos:
        for sc in aml_state_combos:
            for tc in aml_type_combos:
                for dc in aml_date_combos:
                    for nc in aml_norm_combos:
                        label = f"AML | {vname} | acct={ac['label']} | state={sc['label']} | type={tc['label']} | date={dc['label']} | {nc['label']}"
                        sales_candidates.append({
                            'label': label,
                            'source': 'account.move.line',
                            'fn': lambda m, _ac=ac, _sc=sc, _tc=tc, _dc=dc, _nc=nc, _v=vset: compute_aml_sales(
                                m,
                                account_types=_ac['account_types'],
                                move_states=_sc['move_states'],
                                move_types=_tc['move_types'],
                                refund_negative=_tc['refund_negative'],
                                date_field=_dc['date_field'],
                                normalize_uom=_nc['normalize_uom'],
                                variant_filter=_v,
                            ),
                        })

# B) sale.order.line variants
sol_state_combos = [
    {'so_states': ('sale', 'done'), 'label': 'sale_done'},
    {'so_states': ('sale',), 'label': 'sale_only'},
    {'so_states': None, 'label': 'all_states'},
]
sol_qty_combos = [
    {'qty_field': 'qty_delivered', 'require_delivered_gt0': True, 'label': 'qty_delivered_gt0'},
    {'qty_field': 'qty_delivered', 'require_delivered_gt0': False, 'label': 'qty_delivered_any'},
    {'qty_field': 'product_uom_qty', 'require_delivered_gt0': True, 'label': 'qty_ordered_dgt0'},
    {'qty_field': 'product_uom_qty', 'require_delivered_gt0': False, 'label': 'qty_ordered_any'},
    {'qty_field': 'qty_invoiced', 'require_delivered_gt0': False, 'label': 'qty_invoiced'},
]
sol_date_combos = [
    {'date_field': 'effective_date', 'fallback_date': None, 'label': 'eff_date'},
    {'date_field': 'date_order', 'fallback_date': None, 'label': 'date_order'},
    {'date_field': 'commitment_date', 'fallback_date': None, 'label': 'commit_date'},
    {'date_field': 'effective_date', 'fallback_date': 'commitment_date', 'label': 'eff_or_commit'},
    {'date_field': 'effective_date', 'fallback_date': 'date_order', 'label': 'eff_or_order'},
]
for vname, vset in VARIANT_SUBSETS.items():
    for sc in sol_state_combos:
        for qc in sol_qty_combos:
            for dc in sol_date_combos:
                for nc in aml_norm_combos:
                    label = f"SOL | {vname} | state={sc['label']} | qty={qc['label']} | date={dc['label']} | {nc['label']}"
                    sales_candidates.append({
                        'label': label,
                        'source': 'sale.order.line',
                        'fn': lambda m, _sc=sc, _qc=qc, _dc=dc, _nc=nc, _v=vset: compute_sol_sales(
                            m,
                            so_states=_sc['so_states'],
                            qty_field=_qc['qty_field'],
                            require_delivered_gt0=_qc['require_delivered_gt0'],
                            date_field=_dc['date_field'],
                            fallback_date=_dc['fallback_date'],
                            normalize_uom=_nc['normalize_uom'],
                            variant_filter=_v,
                        ),
                    })

print(f"\nSales candidates: {len(sales_candidates)}")

# ----- PURCHASE candidates -----
purchase_candidates_per_metric = {'ordered': [], 'received': [], 'total': []}

# pol-based ordered
for vname, vset in VARIANT_SUBSETS.items():
    for state_combo in [{'po_states': ('purchase', 'done'), 'label': 'purchase_done'},
                        {'po_states': ('purchase',), 'label': 'purchase_only'},
                        {'po_states': None, 'label': 'all_states'}]:
        for date_combo in [{'date_field': 'date_order', 'label': 'date_order'},
                           {'date_field': 'date_planned', 'label': 'date_planned'},
                           {'date_field': 'effective_date', 'label': 'effective_date'}]:
            for nc in aml_norm_combos:
                label_o = f"POL | {vname} | state={state_combo['label']} | date={date_combo['label']} | qty=product_qty | {nc['label']}"
                label_r = f"POL | {vname} | state={state_combo['label']} | date={date_combo['label']} | qty=qty_received | {nc['label']}"
                purchase_candidates_per_metric['ordered'].append({
                    'label': label_o,
                    'fn': lambda m, _s=state_combo, _d=date_combo, _v=vset, _nc=nc:
                        compute_pol_purchases(m, qty_field='product_qty',
                                              po_states=_s['po_states'],
                                              date_field=_d['date_field'],
                                              normalize_uom=_nc['normalize_uom'],
                                              variant_filter=_v),
                })
                purchase_candidates_per_metric['received'].append({
                    'label': label_r,
                    'fn': lambda m, _s=state_combo, _d=date_combo, _v=vset, _nc=nc:
                        compute_pol_purchases(m, qty_field='qty_received',
                                              po_states=_s['po_states'],
                                              date_field=_d['date_field'],
                                              normalize_uom=_nc['normalize_uom'],
                                              variant_filter=_v),
                })
                purchase_candidates_per_metric['total'].append({
                    'label': f"POL | total | {vname} | state={state_combo['label']} | qty=qty_received | {nc['label']}",
                    'fn': lambda _, _s=state_combo, _v=vset, _nc=nc:
                        compute_pol_purchases(None, qty_field='qty_received',
                                              po_states=_s['po_states'],
                                              normalize_uom=_nc['normalize_uom'],
                                              variant_filter=_v, all_time=True),
                })
                purchase_candidates_per_metric['total'].append({
                    'label': f"POL | total | {vname} | state={state_combo['label']} | qty=product_qty | {nc['label']}",
                    'fn': lambda _, _s=state_combo, _v=vset, _nc=nc:
                        compute_pol_purchases(None, qty_field='product_qty',
                                              po_states=_s['po_states'],
                                              normalize_uom=_nc['normalize_uom'],
                                              variant_filter=_v, all_time=True),
                })

# aml-based purchases (vendor bills)
for vname, vset in VARIANT_SUBSETS.items():
    for ac in [{'account_types': ('expense_direct_cost',), 'label': 'expense_direct_cost'},
               {'account_types': ('asset_current',), 'label': 'asset_current'},
               {'account_types': ('expense_direct_cost', 'asset_current'), 'label': 'expense+asset'}]:
        for tc in [{'move_types': ('in_invoice',), 'refund_negative': False, 'label': 'inv_only'},
                   {'move_types': ('in_invoice', 'in_refund'), 'refund_negative': True, 'label': 'inv_refund_neg'}]:
            for dc in [{'date_field': 'invoice_date', 'label': 'invoice_date'},
                       {'date_field': 'date', 'label': 'move.date'}]:
                for nc in aml_norm_combos:
                    label = f"AML | {vname} | acct={ac['label']} | type={tc['label']} | date={dc['label']} | {nc['label']}"
                    purchase_candidates_per_metric['received'].append({
                        'label': label,
                        'fn': lambda m, _ac=ac, _tc=tc, _dc=dc, _nc=nc, _v=vset: compute_aml_purchases(
                            m,
                            account_types=_ac['account_types'],
                            move_types=_tc['move_types'],
                            refund_negative=_tc['refund_negative'],
                            date_field=_dc['date_field'],
                            normalize_uom=_nc['normalize_uom'],
                            variant_filter=_v,
                        ),
                    })
                    purchase_candidates_per_metric['total'].append({
                        'label': f"{label} | total",
                        'fn': lambda _, _ac=ac, _tc=tc, _nc=nc, _v=vset: compute_aml_purchases(
                            None,
                            account_types=_ac['account_types'],
                            move_types=_tc['move_types'],
                            refund_negative=_tc['refund_negative'],
                            normalize_uom=_nc['normalize_uom'],
                            variant_filter=_v, all_time=True,
                        ),
                    })

print(f"Purchase candidates: ordered={len(purchase_candidates_per_metric['ordered'])}, "
      f"received={len(purchase_candidates_per_metric['received'])}, "
      f"total={len(purchase_candidates_per_metric['total'])}")


# ==========================================================================
# Score
# ==========================================================================

print("\nScoring SALES candidates...")
sales_scored = []
for c in sales_candidates:
    nov = c['fn']('2024-11')
    dec = c['fn']('2024-12')
    diff_nov = abs(nov - TARGET['sales_nov2024'])
    diff_dec = abs(dec - TARGET['sales_dec2024'])
    score = diff_nov + diff_dec
    sales_scored.append({
        'label': c['label'], 'source': c.get('source'),
        'nov': nov, 'dec': dec,
        'diff_nov': round(diff_nov, 4), 'diff_dec': round(diff_dec, 4),
        'score': round(score, 4),
    })
sales_scored.sort(key=lambda x: x['score'])

print("Scoring PURCHASES (ordered) candidates...")
po_ord_scored = []
for c in purchase_candidates_per_metric['ordered']:
    v = c['fn']('2024-11')
    diff = abs(v - TARGET['purchases_nov2024_ordered'])
    po_ord_scored.append({
        'label': c['label'], 'value_nov': v,
        'diff': round(diff, 4),
    })
po_ord_scored.sort(key=lambda x: x['diff'])

print("Scoring PURCHASES (received) candidates...")
po_rec_scored = []
for c in purchase_candidates_per_metric['received']:
    v = c['fn']('2024-11')
    diff = abs(v - TARGET['purchases_nov2024_received'])
    po_rec_scored.append({
        'label': c['label'], 'value_nov': v,
        'diff': round(diff, 4),
    })
po_rec_scored.sort(key=lambda x: x['diff'])

print("Scoring PURCHASES (total) candidates...")
po_tot_scored = []
for c in purchase_candidates_per_metric['total']:
    v = c['fn'](None)
    diff = abs(v - TARGET['purchases_all_time_total'])
    po_tot_scored.append({
        'label': c['label'], 'value': v,
        'diff': round(diff, 4),
    })
po_tot_scored.sort(key=lambda x: x['diff'])

# ==========================================================================
# Persist
# ==========================================================================

results = {
    'run_at': datetime.now().isoformat(),
    'targets': TARGET,
    'sales_top50': sales_scored[:50],
    'sales_total_candidates': len(sales_scored),
    'purchase_ordered_top30': po_ord_scored[:30],
    'purchase_received_top30': po_rec_scored[:30],
    'purchase_total_top30': po_tot_scored[:30],
}
OUT_JSON.write_text(json.dumps(results, indent=2, ensure_ascii=False, default=str))
print(f"\nSaved JSON: {OUT_JSON}")

# Markdown summary
def fmt_md_table(rows, cols):
    lines = ['| ' + ' | '.join(cols) + ' |',
             '| ' + ' | '.join('---:' if c.startswith(('value', 'nov', 'dec', 'diff', 'score')) else '---' for c in cols) + ' |']
    for r in rows:
        lines.append('| ' + ' | '.join(str(r.get(c, '')) for c in cols) + ' |')
    return '\n'.join(lines)

md = [
    f"# Find 07 — SSOT Finder Results — SKU 77201046",
    f"",
    f"**Generated:** {datetime.now().isoformat()}",
    f"",
    f"## Targets (CEO's dashboard, per David transcript)",
    f"",
    f"| Metric | Target |",
    f"|---|---:|",
] + [f"| {k} | {v} |" for k, v in TARGET.items()] + [
    "",
    f"## Sales — top 20 (sorted by |Δ Nov| + |Δ Dec|)",
    f"",
    f"Total candidates evaluated: {len(sales_scored)}",
    "",
    fmt_md_table(sales_scored[:20], ['score', 'nov', 'dec', 'diff_nov', 'diff_dec', 'label']),
    "",
    "## Purchases ORDERED Nov 2024 — top 15",
    "",
    fmt_md_table(po_ord_scored[:15], ['diff', 'value_nov', 'label']),
    "",
    "## Purchases RECEIVED Nov 2024 — top 15",
    "",
    fmt_md_table(po_rec_scored[:15], ['diff', 'value_nov', 'label']),
    "",
    "## Purchases TOTAL all-time — top 15",
    "",
    fmt_md_table(po_tot_scored[:15], ['diff', 'value', 'label']),
    "",
    "## Notes",
    "",
    "- Score = absolute gap. Lower = better.",
    "- Same formula may appear with multiple variant scopes; pay attention to whether `active_only_7090`, `all_except_archived`, or `all_3_variants` produces the smallest gap.",
    "- For sales: `out_invoice` only vs `out_invoice + out_refund` (with refund as negative) tests credit-note handling.",
    "- For purchases: separate tables ordered vs received vs total may pick different formulas.",
    "- Top-5 by category is what's presented in the chat for user selection.",
]
OUT_MD.write_text('\n'.join(md))
print(f"Saved MD: {OUT_MD}")

# Print top-5 to stdout
def print_top(name, rows, n=5, cols=None):
    print(f"\n=== TOP {n} — {name} ===")
    for i, r in enumerate(rows[:n], 1):
        if cols:
            line = '  '.join(f"{c}={r.get(c)}" for c in cols)
            print(f"  {i:2d}. {line}")
        else:
            print(f"  {i:2d}. score={r.get('score', r.get('diff'))} | {r['label']}")

print_top('SALES', sales_scored, n=10, cols=['score', 'nov', 'dec', 'diff_nov', 'diff_dec', 'label'])
print_top('PURCHASES ORDERED Nov 2024', po_ord_scored, n=10, cols=['diff', 'value_nov', 'label'])
print_top('PURCHASES RECEIVED Nov 2024', po_rec_scored, n=10, cols=['diff', 'value_nov', 'label'])
print_top('PURCHASES TOTAL all-time', po_tot_scored, n=10, cols=['diff', 'value', 'label'])
