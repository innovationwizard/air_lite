"""
Step 03 — Apply the aggregate_demand_daily_for_product migration to prod.

Reads the SQL file and POSTs it to Supabase via pg_rest... actually, Supabase
doesn't expose raw SQL via PostgREST without a custom RPC. The supported path
is to run the migration via Supabase CLI or via the SQL Editor in the dashboard.

This script ATTEMPTS execution via the `exec_sql` RPC if it exists; otherwise
it prints the SQL and instructions for manual application.
"""
import os
import json
import urllib.request
from pathlib import Path

def load_env():
    for f in ['/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env.local',
              '/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env']:
        p = Path(f)
        if not p.exists(): continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'): continue
            if '=' in line:
                k, v = line.split('=', 1)
                k, v = k.strip(), v.strip()
                if k not in os.environ:
                    os.environ[k] = v
load_env()

SUPA = os.environ['NEXT_PUBLIC_SUPABASE_URL']
KEY = os.environ['SUPABASE_SECRET_KEY']
MIGRATION = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/supabase/migrations/20260423000001_aggregate_demand_daily_for_product.sql')

sql = MIGRATION.read_text()

# Supabase has a `query` endpoint via `pg_meta` extension but it requires service role.
# Simpler path: POST to /rest/v1/rpc/<name> only works for existing RPCs.
# For a brand new function, the common patterns are:
#   (a) run via psql against the Supabase connection string
#   (b) paste in the Supabase Studio SQL editor
# We'll first check whether an `exec_sql` RPC exists in this project.

def try_exec_sql(sql_text):
    body = json.dumps({'query': sql_text}).encode()
    req = urllib.request.Request(
        f"{SUPA}/rest/v1/rpc/exec_sql",
        data=body,
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}',
                 'Content-Type': 'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(req) as r:
            return True, r.read().decode()
    except Exception as e:
        return False, str(e)

ok, resp = try_exec_sql(sql)
if ok:
    print("Migration applied via exec_sql RPC.")
    print(resp)
else:
    print("exec_sql RPC not available.")
    print(f"Response: {resp}")
    print("\n" + "=" * 70)
    print("Manual application required. Two options:\n")
    print("Option 1 — Supabase Studio SQL Editor:")
    print("  https://supabase.com/dashboard/project/plirrpkasyytpgzwwztl/sql/new")
    print(f"  Paste the contents of: {MIGRATION}")
    print("\nOption 2 — psql directly (if you have the connection string):")
    print(f"  psql <connection-string> -f {MIGRATION}")
    print("=" * 70)
