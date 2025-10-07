#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
kirby_C2.py — SSOT builder with full reconciliation (bug-fixed)
- Observations→Matches→Events model (no data loss, no double-counting)
- Name→ID mapping (Excel “Cliente” names → numeric ids), optional alias CSV
- Configurable join tolerance: --dq-mode {exact,5min,60min,day}
- Per-SKU reconciliation rules: excel|csv|mean|max|sum
- Summaries: dq_summary, sales_event_summary
- Fixed: conditional alias usage (no a.client_id unless alias joined), fixed CTE alias
Dependencies: pandas, numpy, openpyxl
"""

import argparse, csv, json, sqlite3, sys
from pathlib import Path
import pandas as pd
import numpy as np

# ----------------------------- Helpers -----------------------------

def zpad_sku(x):
    if pd.isna(x):
        return None
    s = str(x).strip()
    if s.endswith('.0'):
        s = s[:-2]
    digits = ''.join(ch for ch in s if ch.isdigit())
    if digits == '':
        return None
    return digits.zfill(9)

def clean_whitespace(df: pd.DataFrame) -> pd.DataFrame:
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].astype(str).str.strip()
    return df

def robust_read_csv(path: Path) -> pd.DataFrame:
    strategies = [
        dict(sep=',', header=None, engine='python', dtype=str, on_bad_lines='skip'),
        dict(sep=',', header=None, engine='python', dtype=str, quoting=csv.QUOTE_NONE, escapechar='\\', on_bad_lines='skip'),
    ]
    for enc in ['utf-8-sig', 'utf-8', 'latin1', 'cp1252']:
        for params in strategies:
            try:
                df = pd.read_csv(path, encoding=enc, **params)
                if df.shape[1] > 1:
                    return clean_whitespace(df)
            except Exception:
                continue
    raise RuntimeError(f'Failed to parse CSV: {path}')

def to_datetime(s):
    try:
        return pd.to_datetime(s, errors='coerce')
    except Exception:
        return pd.to_datetime(pd.Series(s), errors='coerce')

def normalize_name(s: str) -> str:
    if s is None:
        return None
    t = str(s).upper().strip()
    for ch in [',', '.', ';']:
        t = t.replace(ch, '')
    while '  ' in t:
        t = t.replace('  ', ' ')
    return t

# ----------------------------- Builders -----------------------------

def build_dim_client(df_cli: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame({
        'client_id': df_cli[0].astype(str).str.strip(),
        'client_name': (df_cli[1].fillna('').astype(str).str.strip() + ' ' + df_cli[2].fillna('').astype(str).str.strip()).str.replace(r'\s+', ' ', regex=True).str.strip()
    })
    out = out[out['client_id'].notna() & (out['client_id'] != '')]
    out = out.drop_duplicates(subset=['client_id'])
    return out

def build_fact_sales(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame({
        'qty': pd.to_numeric(df[1], errors='coerce'),
        'metric_2': pd.to_numeric(df[2], errors='coerce'),
        'metric_3': pd.to_numeric(df[3], errors='coerce'),
        'client_id': df[6].astype(str).str.strip(),
        'sku': df[7].map(zpad_sku),
        'product_description': df[8],
        'sale_datetime': to_datetime(df[9]),
        'unit_factor': pd.to_numeric(df[10], errors='coerce'),
        'channel_or_wh_id': df[11].astype(str).str.strip(),
        'invoice_doc': df[12].astype(str).str.strip(),
        'order_or_ref': df[13].astype(str).str.strip(),
        'market_code': df[14].astype(str).str.strip(),
        'source_flag': df[15].astype(str).str.strip()
    })
    out['qty'] = out['qty'].fillna(0)
    out['market_code_label']   = np.where(out['market_code'].notna() & (out['market_code']!=''), 'ASK_' + out['market_code'].astype(str), None)
    out['source_flag_label']   = np.where(out['source_flag'].notna() & (out['source_flag']!=''), 'ASK_' + out['source_flag'].astype(str), None)
    out['channel_or_wh_label'] = np.where(out['channel_or_wh_id'].notna() & (out['channel_or_wh_id']!=''), 'ASK_' + out['channel_or_wh_id'].astype(str), None)
    out['qty_unit_or_pack']    = 'ASK_UNIT_OR_PACK_qty'
    out['metric_2_semantics']  = 'ASK_metric_2'
    out['metric_3_semantics']  = 'ASK_metric_3'
    return out

def build_fact_returns(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame({
        'qty': pd.to_numeric(df[1], errors='coerce'),
        'metric_a': pd.to_numeric(df[0], errors='coerce'),
        'metric_b': pd.to_numeric(df[2], errors='coerce'),
        'client_id': df[3].astype(str).str.strip(),
        'sku': df[4].map(zpad_sku),
        'product_description': df[5],
        'return_datetime': to_datetime(df[6]),
        'metric_c': pd.to_numeric(df[7], errors='coerce'),
        'credit_note_doc': df[8].astype(str).str.strip(),
        'return_reason': df[9],
        'market_code': df[10].astype(str).str.strip(),
        'source_flag': df[11].astype(str).str.strip()
    })
    out['qty'] = out['qty'].fillna(0)
    out['market_code_label']  = np.where(out['market_code'].notna() & (out['market_code']!=''), 'ASK_' + out['market_code'].astype(str), None)
    out['source_flag_label']  = np.where(out['source_flag'].notna() & (out['source_flag']!=''), 'ASK_' + out['source_flag'].astype(str), None)
    out['qty_unit_or_pack']   = 'ASK_UNIT_OR_PACK_qty'
    out['metric_a_semantics'] = 'ASK_metric_a'
    out['metric_b_semantics'] = 'ASK_metric_b'
    out['metric_c_semantics'] = 'ASK_metric_c'
    return out

# ----------------------------- SQLite utils -----------------------------

def open_db(db_path: Path):
    con = sqlite3.connect(str(db_path), timeout=5.0)
    con.execute("PRAGMA journal_mode=WAL;")
    con.execute("PRAGMA busy_timeout=5000;")
    con.execute("PRAGMA synchronous=OFF;")
    con.execute("PRAGMA temp_store=MEMORY;")
    return con

def write_table(con, name: str, df: pd.DataFrame):
    df.to_sql(name, con, if_exists='replace', index=False, chunksize=10000, method='multi')

def build_indexes_and_views(con, have_product_master: bool):
    idx_sql = [
        "CREATE INDEX IF NOT EXISTS ix_sales_sku ON fact_sales(sku);",
        "CREATE INDEX IF NOT EXISTS ix_sales_client ON fact_sales(client_id);",
        "CREATE INDEX IF NOT EXISTS ix_sales_date ON fact_sales(sale_datetime);",
        "CREATE INDEX IF NOT EXISTS ix_ret_sku ON fact_returns(sku);",
        "CREATE INDEX IF NOT EXISTS ix_ret_client ON fact_returns(client_id);",
        "CREATE INDEX IF NOT EXISTS ix_ret_date ON fact_returns(return_datetime);",
        "CREATE INDEX IF NOT EXISTS ix_cli ON dim_client(client_id);",
    ]
    for sql in idx_sql:
        con.execute(sql)

    if have_product_master:
        con.executescript("""
        DROP VIEW IF EXISTS dim_product;
        CREATE VIEW dim_product AS
        SELECT
            pm.sku,
            COALESCE(pm.Nombre, vd.product_description, dr.product_description) AS product_name,
            pm.Descripción AS product_description_long,
            pm.Categoria AS category,
            pm."Tipo de abastecimiento" AS supply_type,
            pm.costo AS cost,
            pm."Precio de venta mas bajo" AS price_min,
            pm."Vida util" AS shelf_life,
            pm."Cantidad minima de pedido" AS moq
        FROM dim_product_master pm
        LEFT JOIN (
            SELECT sku, MAX(product_description) AS product_description
            FROM fact_sales
            WHERE sku IS NOT NULL AND product_description IS NOT NULL
            GROUP BY 1
        ) vd ON vd.sku = pm.sku
        LEFT JOIN (
            SELECT sku, MAX(product_description) AS product_description
            FROM fact_returns
            WHERE sku IS NOT NULL AND product_description IS NOT NULL
            GROUP BY 1
        ) dr ON dr.sku = pm.sku;
        """)

# ----------------------------- DQ pipeline -----------------------------

def materialize_staging_and_mapping(con):
    con.executescript("""
    DROP TABLE IF EXISTS stg_sales_csv_mat;
    CREATE TABLE stg_sales_csv_mat AS
    SELECT strftime('%Y-%m-%d %H:%M:%S', sale_datetime) AS ts,
           sku, client_id, qty, market_code, source_flag
    FROM fact_sales;
    CREATE INDEX IF NOT EXISTS ix_csv_mat_key ON stg_sales_csv_mat(ts,sku,client_id);
    """)
    con.executescript("""
    DROP TABLE IF EXISTS stg_sales_excel;
    CREATE TABLE stg_sales_excel AS SELECT * FROM excel_sales;
    """)
    con.executescript("""
    DROP TABLE IF EXISTS stg_sales_excel_mat;
    CREATE TABLE stg_sales_excel_mat AS
    SELECT strftime('%Y-%m-%d %H:%M:%S', "Fecha y hora de venta") AS ts,
           substr('000000000'||CAST("SKU" AS TEXT), -9, 9) AS sku,
           CAST("Cliente" AS TEXT) AS client_id,
           CAST("Cantidad vendida" AS REAL) AS qty,
           CAST("Segmento de mercado o canal" AS TEXT) AS market_code,
           CAST("Indicador de promocioón" AS TEXT) AS source_flag
    FROM stg_sales_excel;
    CREATE INDEX IF NOT EXISTS ix_excel_mat_key ON stg_sales_excel_mat(ts,sku,client_id);
    """)
    con.executescript("""
    DROP TABLE IF EXISTS dim_client_norm;
    CREATE TABLE dim_client_norm AS
    SELECT client_id,
           UPPER(TRIM(REPLACE(REPLACE(REPLACE(client_name, ',', ''), '.', ''), '  ', ' '))) AS client_name_norm
    FROM dim_client;
    CREATE INDEX IF NOT EXISTS ix_dcn_name ON dim_client_norm(client_name_norm);

    DROP TABLE IF EXISTS stg_sales_excel_norm;
    CREATE TABLE stg_sales_excel_norm AS
    SELECT ts, sku,
           client_id AS cliente_raw,
           UPPER(TRIM(REPLACE(REPLACE(REPLACE(client_id, ',', ''), '.', ''), '  ', ' '))) AS client_name_norm,
           qty, market_code, source_flag
    FROM stg_sales_excel_mat;
    CREATE INDEX IF NOT EXISTS ix_exn_key ON stg_sales_excel_norm(ts,sku,client_name_norm);
    """)

def apply_client_alias_and_map(con, client_alias_csv: str|None):
    use_alias = False
    if client_alias_csv and Path(client_alias_csv).exists():
        alias_df = pd.read_csv(client_alias_csv, dtype=str)
        alias_df.columns = [c.strip().lower() for c in alias_df.columns]
        if {'excel_name','client_id'}.issubset(set(alias_df.columns)):
            alias_df['excel_name_norm'] = alias_df['excel_name'].map(normalize_name)
            alias_df = alias_df[['excel_name_norm','client_id']].dropna()
            alias_df = alias_df.drop_duplicates(subset=['excel_name_norm'])
            alias_df.to_sql('client_alias', con, if_exists='replace', index=False)
            con.execute("CREATE INDEX IF NOT EXISTS ix_alias_name ON client_alias(excel_name_norm);")
            use_alias = True
        else:
            print("Warning: client_alias CSV missing required columns (excel_name,client_id). Ignoring.", file=sys.stderr)

    alias_join = "LEFT JOIN client_alias a ON a.excel_name_norm = e.client_name_norm" if use_alias else ""
    alias_select = "COALESCE(a.client_id, d.client_id, e.cliente_raw) AS client_id" if use_alias else "COALESCE(d.client_id, e.cliente_raw) AS client_id"

    con.executescript(f"""
    DROP TABLE IF EXISTS stg_sales_excel_mapped;
    CREATE TABLE stg_sales_excel_mapped AS
    SELECT e.ts, e.sku,
           {alias_select},
           e.qty, e.market_code, e.source_flag
    FROM stg_sales_excel_norm e
    {alias_join}
    LEFT JOIN dim_client_norm d ON d.client_name_norm = e.client_name_norm;
    CREATE INDEX IF NOT EXISTS ix_exm_key ON stg_sales_excel_mapped(ts,sku,client_id);
    """)

def build_sales_join(con, dq_mode: str):
    if dq_mode == 'exact':
        time_pred = "c.ts = e.ts"
    elif dq_mode == 'day':
        time_pred = "DATE(c.ts) = DATE(e.ts)"
    elif dq_mode == '60min':
        time_pred = "ABS(strftime('%s',c.ts)-strftime('%s',e.ts))<=3600"
    else:
        time_pred = "ABS(strftime('%s',c.ts)-strftime('%s',e.ts))<=300"

    con.executescript(f"""
    DROP TABLE IF EXISTS sales_join_mat;
    CREATE TABLE sales_join_mat AS
    SELECT c.ts, c.sku, c.client_id, c.qty AS qty_csv, e.qty AS qty_excel,
           c.market_code AS market_csv, e.market_code AS market_excel,
           c.source_flag AS source_csv, e.source_flag AS source_excel,
           CASE
             WHEN e.ts IS NULL THEN 'csv_only'
             WHEN ABS(COALESCE(c.qty,0)-COALESCE(e.qty,0)) < 1e-9 THEN 'dup_equal'
             ELSE 'conflict_qty'
           END AS join_status
    FROM stg_sales_csv_mat c
    LEFT JOIN stg_sales_excel_mapped e
      ON c.sku=e.sku AND c.client_id=e.client_id AND {time_pred}
    UNION ALL
    SELECT e.ts, e.sku, e.client_id, c.qty, e.qty,
           c.market_code, e.market_code, c.source_flag, e.source_flag, 'excel_only'
    FROM stg_sales_excel_mapped e
    LEFT JOIN stg_sales_csv_mat c
      ON c.sku=e.sku AND c.client_id=e.client_id AND {time_pred}
    WHERE c.ts IS NULL;

    CREATE INDEX IF NOT EXISTS ix_sales_join_status ON sales_join_mat(join_status);

    DROP TABLE IF EXISTS dq_summary;
    CREATE TABLE dq_summary AS
    SELECT
      (SELECT COUNT(*) FROM stg_sales_excel_mapped) AS excel_inputs,
      SUM(CASE WHEN join_status='conflict_qty' THEN 1 ELSE 0 END) AS conflicts,
      SUM(CASE WHEN join_status='dup_equal'    THEN 1 ELSE 0 END) AS dup_equals,
      SUM(CASE WHEN join_status IN ('conflict_qty','dup_equal') THEN 1 ELSE 0 END) AS left_out_total,
      ROUND(
        100.0 * SUM(CASE WHEN join_status IN ('conflict_qty','dup_equal') THEN 1 ELSE 0 END)
        / NULLIF((SELECT COUNT(*) FROM stg_sales_excel_mapped),0), 4
      ) AS left_out_pct_of_excel
    FROM sales_join_mat;
    """)

def build_observations_matches_events(con, recon_rules_csv: str|None):
    con.executescript("""
    DROP TABLE IF EXISTS sales_observation;
    CREATE TABLE sales_observation (
      obs_id        INTEGER PRIMARY KEY,
      source        TEXT,
      sale_datetime TEXT,
      sku           TEXT,
      client_id     TEXT,
      qty           REAL,
      market_code   TEXT,
      source_flag   TEXT
    );
    INSERT INTO sales_observation(source,sale_datetime,sku,client_id,qty,market_code,source_flag)
    SELECT 'csv',   ts, sku, client_id, qty, market_code, source_flag FROM stg_sales_csv_mat;
    INSERT INTO sales_observation(source,sale_datetime,sku,client_id,qty,market_code,source_flag)
    SELECT 'excel', ts, sku, client_id, qty, market_code, source_flag FROM stg_sales_excel_mapped;
    CREATE INDEX IF NOT EXISTS ix_obs_key ON sales_observation(sku,client_id,sale_datetime);
    CREATE INDEX IF NOT EXISTS ix_obs_src ON sales_observation(source);
    """)

    con.executescript("""
    DROP TABLE IF EXISTS sales_match;
    CREATE TABLE sales_match AS
    WITH j AS (
      SELECT * FROM sales_join_mat WHERE join_status IN ('dup_equal','conflict_qty')
    )
    SELECT
      c.obs_id AS csv_obs_id,
      e.obs_id AS excel_obs_id,
      j.sku, j.client_id,
      ABS(strftime('%s',c.sale_datetime)-strftime('%s',e.sale_datetime)) AS delta_sec,
      j.qty_csv, j.qty_excel,
      CASE WHEN j.join_status='dup_equal' THEN 'dup_equal' ELSE 'conflict_qty' END AS match_status
    FROM j
    JOIN sales_observation c ON c.source='csv'   AND c.sku=j.sku AND c.client_id=j.client_id AND c.sale_datetime=j.ts
    JOIN sales_observation e ON e.source='excel' AND e.sku=j.sku AND e.client_id=j.client_id AND e.sale_datetime=j.ts;
    CREATE INDEX IF NOT EXISTS ix_match_csv   ON sales_match(csv_obs_id);
    CREATE INDEX IF NOT EXISTS ix_match_excel ON sales_match(excel_obs_id);
    """)

    con.executescript("DROP TABLE IF EXISTS recon_rules; CREATE TABLE recon_rules (sku TEXT PRIMARY KEY, strategy TEXT NOT NULL CHECK (strategy IN ('excel','csv','mean','max','sum')) DEFAULT 'excel');")
    if recon_rules_csv and Path(recon_rules_csv).exists():
        rr = pd.read_csv(recon_rules_csv, dtype=str)
        rr.columns = [c.strip().lower() for c in rr.columns]
        if not {'sku','strategy'}.issubset(set(rr.columns)):
            raise ValueError("recon_rules CSV must have columns: sku,strategy")
        rr['sku'] = rr['sku'].map(zpad_sku)
        rr = rr[['sku','strategy']].dropna()
        rr.to_sql('recon_rules', con, if_exists='append', index=False)

    con.executescript("""
    DROP TABLE IF EXISTS sales_event;
    CREATE TABLE sales_event AS
    WITH paired AS (
      SELECT m.*, COALESCE(rr.strategy,'excel') AS strategy
      FROM sales_match m
      LEFT JOIN recon_rules rr USING (sku)
    )
    SELECT
      (SELECT sale_datetime FROM sales_observation WHERE obs_id=excel_obs_id) AS sale_datetime,
      sku, client_id,
      CASE strategy
        WHEN 'excel' THEN qty_excel
        WHEN 'csv'   THEN qty_csv
        WHEN 'mean'  THEN (qty_csv + qty_excel)/2.0
        WHEN 'max'   THEN CASE WHEN qty_csv>qty_excel THEN qty_csv ELSE qty_excel END
        WHEN 'sum'   THEN (qty_csv + qty_excel)
      END AS qty_reconciled,
      'paired' AS event_type,
      strategy  AS recon_strategy,
      csv_obs_id,
      excel_obs_id,
      CASE WHEN qty_csv=qty_excel THEN 'dup_equal' ELSE 'conflict_qty' END AS dq_status
    FROM paired

    UNION ALL
    SELECT o.sale_datetime, o.sku, o.client_id, o.qty AS qty_reconciled,
           'csv_only' AS event_type, NULL AS recon_strategy,
           o.obs_id AS csv_obs_id, NULL AS excel_obs_id, 'csv_only' AS dq_status
    FROM sales_observation o
    LEFT JOIN sales_match m ON m.csv_obs_id=o.obs_id
    WHERE o.source='csv' AND m.csv_obs_id IS NULL

    UNION ALL
    SELECT o.sale_datetime, o.sku, o.client_id, o.qty AS qty_reconciled,
           'excel_only' AS event_type, NULL AS recon_strategy,
           NULL AS csv_obs_id, o.obs_id AS excel_obs_id, 'excel_only' AS dq_status
    FROM sales_observation o
    LEFT JOIN sales_match m ON m.excel_obs_id=o.obs_id
    WHERE o.source='excel' AND m.excel_obs_id IS NULL
    ;
    CREATE INDEX IF NOT EXISTS ix_event_sku_date ON sales_event(sku, sale_datetime);
    CREATE INDEX IF NOT EXISTS ix_event_type     ON sales_event(event_type);
    CREATE INDEX IF NOT EXISTS ix_event_dq       ON sales_event(dq_status);

    DROP TABLE IF EXISTS sales_event_summary;
    CREATE TABLE sales_event_summary AS
    SELECT COUNT(*) AS events,
           SUM(event_type='paired')      AS paired_events,
           SUM(dq_status='conflict_qty') AS conflicts_paired,
           ROUND(100.0*SUM(dq_status='conflict_qty')/NULLIF(SUM(event_type='paired'),0),4) AS conflicts_pct_of_paired
    FROM sales_event;
    """)

# ----------------------------- Main -----------------------------

def main():
    ap = argparse.ArgumentParser(description="Build SSOT with reconciliation (kirby_C2)")
    ap.add_argument("--input", required=True, help="Directory with source files")
    ap.add_argument("--output", required=True, help="Output directory for SSOT")
    ap.add_argument("--dq-mode", choices=["exact","5min","60min","day"], default="5min", help="Matching tolerance for csv↔excel")
    ap.add_argument("--client-alias", help="CSV with columns: excel_name,client_id (optional)", default=None)
    ap.add_argument("--recon-rules", help="CSV with columns: sku,strategy (excel|csv|mean|max|sum)", default=None)
    args = ap.parse_args()

    in_dir = Path(args.input)
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Load CSVs
    venta_df  = robust_read_csv(in_dir / 'Venta 15 al 24.csv')
    devol_df  = robust_read_csv(in_dir / 'devolucion 15 al 24.csv')
    client_df = robust_read_csv(in_dir / 'clientes 15 al 24.csv')

    dim_client   = build_dim_client(client_df)
    fact_sales   = build_fact_sales(venta_df)
    fact_returns = build_fact_returns(devol_df)

    # Optional Excel
    excel_tables = {}
    xlsx = in_dir / 'Envio de datos a Condor.xlsx'
    if xlsx.exists():
        try:
            xls = pd.ExcelFile(xlsx, engine="openpyxl")
            if 'Datos maestro de producto' in xls.sheet_names:
                pm = xls.parse('Datos maestro de producto', dtype=str).copy()
                if 'SKU' in pm.columns:
                    pm['sku'] = pm['SKU'].map(zpad_sku)
                    pm.drop(columns=['SKU'], inplace=True)
                excel_tables['dim_product_master'] = pm
            if 'Datos de venta' in xls.sheet_names:
                es = xls.parse('Datos de venta', dtype=str).copy()
                excel_tables['excel_sales'] = es
        except ImportError:
            print("openpyxl not available → Excel sheets skipped", file=sys.stderr)

    # Write normalized CSVs
    dim_client.to_csv(out_dir/'dim_client.csv', index=False, encoding='utf-8')
    fact_sales.to_csv(out_dir/'fact_sales.csv', index=False, encoding='utf-8')
    fact_returns.to_csv(out_dir/'fact_returns.csv', index=False, encoding='utf-8')
    for name, df in excel_tables.items():
        df.to_csv(out_dir/f'{name}.csv', index=False, encoding='utf-8')

    # Build SQLite
    db_path = out_dir / 'ssot.db'
    con = open_db(db_path)
    try:
        write_table(con, 'dim_client', dim_client)
        write_table(con, 'fact_sales', fact_sales)
        write_table(con, 'fact_returns', fact_returns)
        have_pm = False
        if 'dim_product_master' in excel_tables:
            write_table(con, 'dim_product_master', excel_tables['dim_product_master'])
            have_pm = True
        if 'excel_sales' in excel_tables:
            write_table(con, 'excel_sales', excel_tables['excel_sales'])
        build_indexes_and_views(con, have_pm)

        if 'excel_sales' in excel_tables:
            materialize_staging_and_mapping(con)
            apply_client_alias_and_map(con, args.client_alias)
            build_sales_join(con, args.dq_mode)
            build_observations_matches_events(con, args.recon_rules)

        prof = {
            'sales_rows': int(len(fact_sales)),
            'returns_rows': int(len(fact_returns)),
            'clients_rows': int(len(dim_client)),
            'sales_date_min': str(pd.to_datetime(fact_sales['sale_datetime'], errors='coerce').min()),
            'sales_date_max': str(pd.to_datetime(fact_sales['sale_datetime'], errors='coerce').max()),
            'returns_date_min': str(pd.to_datetime(fact_returns['return_datetime'], errors='coerce').min()),
            'returns_date_max': str(pd.to_datetime(fact_returns['return_datetime'], errors='coerce').max()),
            'unique_skus_in_sales': int(fact_sales['sku'].nunique()),
            'unique_clients_in_sales': int(fact_sales['client_id'].nunique()),
        }
        if 'excel_sales' in excel_tables:
            row = con.execute("""
                SELECT COUNT(*) AS excel_rows,
                       SUM(CASE WHEN client_id IS NOT NULL AND client_id NOT GLOB '*[A-Za-z]*' THEN 1 ELSE 0 END) AS mapped_to_id
                FROM stg_sales_excel_mapped;""").fetchone()
            excel_rows, mapped_to_id = row[0], row[1]
            prof.update({
                'excel_rows': int(excel_rows),
                'excel_mapped_to_id': int(mapped_to_id),
                'excel_mapped_pct': float(round(100.0*mapped_to_id/excel_rows, 4)) if excel_rows else 0.0
            })
            dq = con.execute("SELECT excel_inputs, conflicts, dup_equals, left_out_total, left_out_pct_of_excel FROM dq_summary").fetchone()
            prof.update({
                'dq_excel_inputs': int(dq[0]),
                'dq_conflicts': int(dq[1]),
                'dq_dup_equals': int(dq[2]),
                'dq_left_out_total': int(dq[3]),
                'dq_left_out_pct_of_excel': float(dq[4]),
                'dq_mode': args.dq_mode
            })
            ev = con.execute("SELECT events, paired_events, conflicts_paired, conflicts_pct_of_paired FROM sales_event_summary").fetchone()
            prof.update({
                'events_total': int(ev[0]),
                'events_paired': int(ev[1]),
                'events_conflicts_paired': int(ev[2]),
                'events_conflicts_pct_of_paired': float(ev[3])
            })

        (out_dir/'profile.json').write_text(json.dumps(prof, indent=2, ensure_ascii=False), encoding='utf-8')

        if 'excel_sales' in excel_tables:
            ev_df = pd.read_sql_query("SELECT * FROM sales_event", con)
            ev_df.to_csv(out_dir/'sales_event.csv', index=False, encoding='utf-8')
    finally:
        con.close()

    print("SSOT built at:", db_path)
    print("Outputs in   :", out_dir)
    if 'excel_sales' not in excel_tables:
        print("Note: Excel ventas not found or openpyxl missing → reconciliation limited to CSV sources.", file=sys.stderr)

if __name__ == "__main__":
    main()
