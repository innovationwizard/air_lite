"""Read `config_rules`. Missing row, failed query, or unusable shape → fallback.

Phase 1 of the reabastecimiento rule table. Callers keep the constant they
used before the table existed and pass it in as `fallback`. This module does
not know those business values, and it never raises: a sync or a page load
that cannot see the table keeps calculating with the constant.

Keys contain dots (`stock.patio`). PostgREST treats an unquoted dot in a
filter as syntax, so the read is the whole table — a handful of rows — and
the key match happens here.
"""

import json
import logging
import os
import urllib.request
from copy import deepcopy

logger = logging.getLogger(__name__)

# The only origin and the only transit cutoff this phase knows how to apply.
# A stored value that names something else is not given a new meaning; the
# caller keeps its fallback, which is the previous behavior.
ORIGIN_WAREHOUSE_LOT_STOCK = 'warehouse_lot_stock'
TRANSIT_CUTOFF_TODAY_UTC = 'today_utc'


def _env():
    url = (os.environ.get('SUPABASE_URL')
           or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
           or '')
    secret = (os.environ.get('SUPABASE_SECRET_KEY')
              or os.environ.get('SUPABASE_KEY')
              or '')
    return url.rstrip('/'), secret


def _nonempty_str(value):
    return isinstance(value, str) and bool(value) and value == value.strip()


def _str_list(value):
    """A list of non-empty strings, or None. An empty list is an empty list."""
    if isinstance(value, list) and all(_nonempty_str(item) for item in value):
        return list(value)
    return None


def accept_existencias(value):
    """{"kind": "Existencias"} — the location segment, not a list of ids.

    A slash would make `{code}/{kind}` and `/{kind}` a different rule than
    the one the sync builds, so that shape is rejected.
    """
    if not isinstance(value, dict):
        return None
    kind = value.get('kind')
    if not _nonempty_str(kind) or '/' in kind:
        return None
    return {'kind': kind}


def accept_patio(value):
    """{"location": "1CET/Entrada", "bodegas": ["San Jose VN", "General"]}."""
    if not isinstance(value, dict):
        return None
    location = value.get('location')
    bodegas = _str_list(value.get('bodegas'))
    if not _nonempty_str(location) or bodegas is None:
        return None
    return {'location': location, 'bodegas': frozenset(bodegas)}


def accept_transit_rules(value):
    """{"states": ["purchase", "done"], "date_cutoff": "today_utc"}.

    `today_utc` means the PO header date_planned is compared, as text, to
    today's UTC date at 00:00:00 (`%Y-%m-%d 00:00:00`). It is not a stored
    timestamp. Any other cutoff is rejected rather than interpreted.
    """
    if not isinstance(value, dict):
        return None
    states = _str_list(value.get('states'))
    if not states:
        return None
    if value.get('date_cutoff') != TRANSIT_CUTOFF_TODAY_UTC:
        return None
    return {'states': states, 'date_cutoff': TRANSIT_CUTOFF_TODAY_UTC}


def accept_prefix_map(value):
    """{"PO-P-": "1CET", ...} — exact prefix to exact warehouse code.

    An empty object would attribute nothing and is not a map this reader
    will apply; the caller keeps the previous map.
    """
    if not isinstance(value, dict) or not value:
        return None
    out = {}
    for key, code in value.items():
        if not _nonempty_str(key) or not _nonempty_str(code) or '/' in code:
            return None
        out[key] = code
    return out


def accept_pendiente(value):
    """Picking-type codes, excluded move states, and the origin rule.

    `origin` `warehouse_lot_stock` is the filter that was hardcoded: the
    move leaves stock.warehouse.lot_stock_id, the bodega's Existencias.
    """
    if not isinstance(value, dict):
        return None
    codes = _str_list(value.get('sequence_codes'))
    states = _str_list(value.get('excluded_states'))
    if not codes or not states:
        return None
    if value.get('origin') != ORIGIN_WAREHOUSE_LOT_STOCK:
        return None
    return {
        'sequence_codes': tuple(codes),
        'excluded_states': tuple(states),
        'origin': ORIGIN_WAREHOUSE_LOT_STOCK,
    }


def _number(value):
    """A JSON number. Booleans are ints in Python and are not a factor."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and (value != value or value in (float('inf'), float('-inf'))):
        return None
    return value


def accept_engine_factors(value):
    """{"general_growth": 1.1, "t_divisor": 20, "weekdays": 26,
    "win_general": 10, "win_other": 5}."""
    if not isinstance(value, dict):
        return None
    keys = ('general_growth', 't_divisor', 'weekdays', 'win_general', 'win_other')
    out = {}
    for key in keys:
        number = _number(value.get(key))
        if number is None:
            return None
        out[key] = number
    if out['t_divisor'] == 0 or out['weekdays'] == 0:
        return None
    if out['win_general'] <= 0 or out['win_other'] <= 0:
        return None
    return out


def accept_excluded_wh(value):
    """["5DEP"] — warehouse codes left out of the General roll-up."""
    codes = _str_list(value)
    if codes is None or any('/' in code for code in codes):
        return None
    return tuple(codes)


def _fetch_all(url, secret):
    req = urllib.request.Request(
        f'{url}/rest/v1/config_rules?select=key,value',
        method='GET',
        headers={
            'apikey': secret,
            'Authorization': f'Bearer {secret}',
            'Accept': 'application/json',
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read()
    data = json.loads(raw) if raw else []
    if not isinstance(data, list):
        raise ValueError('config_rules response was not a list')
    return data


def read_config(specs):
    """`{key: (fallback, accept)}` → `{key: value}`. Never raises.

    `accept` returns a normalized value, or None when the stored JSON is not
    a shape the caller can apply. None keeps `fallback`.
    """
    resolved = {key: deepcopy(fallback) for key, (fallback, _accept) in specs.items()}
    url, secret = _env()
    if not url or not secret:
        logger.info('config_rules: no supabase credentials — fallback for %s', list(specs))
        return resolved
    try:
        rows = _fetch_all(url, secret)
    except Exception as exc:  # noqa: BLE001 — a failed read is the fallback path
        logger.warning('config_rules read failed (%s) — fallback for %s', exc, list(specs))
        return resolved

    by_key = {}
    for row in rows:
        if isinstance(row, dict) and isinstance(row.get('key'), str):
            by_key[row['key']] = row.get('value')

    used = []
    for key, (_fallback, accept) in specs.items():
        if key not in by_key:
            continue
        accepted = accept(by_key[key])
        if accepted is None:
            logger.warning('config_rules %s: unexpected shape — fallback', key)
            continue
        resolved[key] = accepted
        used.append(key)
    missing = [key for key in specs if key not in used]
    logger.info('config_rules from db: %s; fallback: %s', used or '-', missing or '-')
    return resolved
