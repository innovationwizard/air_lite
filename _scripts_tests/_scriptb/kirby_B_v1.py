#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import argparse, csv, json, sqlite3, sys
from pathlib import Path
import pandas as pd
import numpy as np

ASK_NUMERIC_SEMANTICS = {
    "sales.metric_2": "ASK_metric_2",
    "sales.metric_3": "ASK_metric_3",
    "returns.metric_a": "ASK_metric_a",
    "returns.metric_b": "ASK_metric_b",
    "returns.metric_c": "ASK_metric_c",
}

ASK_UNITS = {
    "sales.qty": "ASK_UNIT_OR_PACK_qty",
    "returns.qty": "ASK_UNIT_OR_PACK_qty",
}

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
                    return df.map(lambda x: x.strip() if isinstance(x, str) else x)
            except Exception:
                continue
    raise RuntimeError(f'Failed to parse CSV: {path}')

def to_datetime(s):
    try:
        return pd.to_datetime(s, errors='coerce')
    except Exception:
        return pd.to_datetime(pd.Series(s), errors='coerce')

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
    # Placeholder labeling
    out['market_code_label'] = np.where(out['market_code'].notna() & (out['market_code']!=''), 'ASK_' + out['market_code'].astype(str), None)
    out['source_flag_label'] = np.where(out['source_flag'].notna() & (out['source_flag']!=''), 'ASK_' + out['source_flag'].astype(str), None)
    out['channel_or_wh_label'] = np.where(out['channel_or_wh_id'].notna() & (out['channel_or_wh_id']!=''), 'ASK_' + out['channel_or_wh_id'].astype(str), None)
    out['qty_unit_or_pack'] = ASK_UNITS['sales.qty']
    out['metric_2_semantics'] = ASK_NUMERIC_SEMANTICS['sales.metric_2']
    out['metric_3_semantics'] = ASK_NUMERIC_SEMANTICS['sales.metric_3']
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
    # Placeholder labeling
    out['market_code_label'] = np.where(out['market_code'].notna() & (out['market_code']!=''), 'ASK_' + out['market_code'].astype(str), None)
    out['source_flag_label'] = np.where(out['source_flag'].notna() & (out['source_flag']!=''), 'ASK_' + out['source_flag'].astype(str), None)
    out['qty_unit_or_pack'] = ASK_UNITS['returns.qty']
    out['metric_a_semantics'] = ASK_NUMERIC_SEMANTICS['returns.metric_a']
    out['metric_b_semantics'] = ASK_NUMERIC_SEMANTICS['returns.metric_b']
    out['metric_c_semantics'] = ASK_NUMERIC_SEMANTICS['returns.metric_c']
    return out

def tables_to_sqlite(db_path: Path, tables: dict):
    conn = sqlite3.connect(str(db_path))
    try:
        for name, df in tables.items():
            df.to_sql(name, conn, if_exists='replace', index=False)
        for sql in [
            "CREATE INDEX IF NOT EXISTS ix_sales_sku ON fact_sales(sku);",
            "CREATE INDEX IF NOT EXISTS ix_sales_client ON fact_sales(client_id);",
            "CREATE INDEX IF NOT EXISTS ix_sales_date ON fact_sales(sale_datetime);",
            "CREATE INDEX IF NOT EXISTS ix_ret_sku ON fact_returns(sku);",
            "CREATE INDEX IF NOT EXISTS ix_ret_client ON fact_returns(client_id);",
            "CREATE INDEX IF NOT EXISTS ix_ret_date ON fact_returns(return_datetime);",
            "CREATE INDEX IF NOT EXISTS ix_cli ON dim_client(client_id);",
        ]:
            try: conn.execute(sql)
            except: pass

        if 'dim_product_master' in tables:
            conn.executescript("""
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

        if 'excel_sales' in tables:
            # Stage normalized projections for join & SSOT
            conn.executescript("""
            DROP VIEW IF EXISTS stg_sales_csv;
            CREATE VIEW stg_sales_csv AS
            SELECT
                strftime('%Y-%m-%d %H:%M:%S', sale_datetime) AS ts,
                COALESCE(sku,'') AS sku,
                COALESCE(client_id,'') AS client_id,
                qty, market_code, source_flag, invoice_doc, order_or_ref
            FROM fact_sales;

            DROP VIEW IF EXISTS stg_sales_excel;
            CREATE VIEW stg_sales_excel AS
            SELECT
                strftime('%Y-%m-%d %H:%M:%S', "Fecha y hora de venta") AS ts,
                substr('000000000'||CAST("SKU" AS TEXT), -9, 9) AS sku,
                CAST("Cliente" AS TEXT) AS client_id,
                CAST("Cantidad vendida" AS REAL) AS qty,
                CAST("Segmento de mercado o canal" AS TEXT) AS market_code,
                CAST("Indicador de promocioón" AS TEXT) AS source_flag,
                NULL AS invoice_doc,
                NULL AS order_or_ref
            FROM excel_sales;

            -- Emulate FULL OUTER JOIN via UNION of left and anti-join
            DROP VIEW IF EXISTS sales_join;
            CREATE VIEW sales_join AS
            SELECT c.ts, c.sku, c.client_id, c.qty AS qty_csv, e.qty AS qty_excel,
                   c.market_code AS market_csv, e.market_code AS market_excel,
                   c.source_flag AS source_csv, e.source_flag AS source_excel,
                   CASE WHEN e.ts IS NULL THEN 'csv_only'
                        WHEN ABS(COALESCE(c.qty,0) - COALESCE(e.qty,0)) < 1e-9 THEN 'dup_equal'
                        ELSE 'conflict_qty' END AS join_status
            FROM stg_sales_csv c
            LEFT JOIN stg_sales_excel e
              ON c.ts = e.ts AND c.sku = e.sku AND c.client_id = e.client_id
            UNION ALL
            SELECT e.ts, e.sku, e.client_id, c.qty AS qty_csv, e.qty AS qty_excel,
                   c.market_code AS market_csv, e.market_code AS market_excel,
                   c.source_flag AS source_csv, e.source_flag AS source_excel,
                   'excel_only' AS join_status
            FROM stg_sales_excel e
            LEFT JOIN stg_sales_csv c
              ON c.ts = e.ts AND c.sku = e.sku AND c.client_id = e.client_id
            WHERE c.ts IS NULL;

            DROP VIEW IF EXISTS ssot_sales;
            CREATE VIEW ssot_sales AS
            SELECT s.sale_datetime, s.sku, s.client_id, s.qty, s.market_code, s.source_flag, s.invoice_doc, s.order_or_ref, 'csv' AS source
            FROM fact_sales s
            UNION ALL
            SELECT e."Fecha y hora de venta" AS sale_datetime,
                   substr('000000000'||CAST(e."SKU" AS TEXT), -9, 9) AS sku,
                   CAST(e."Cliente" AS TEXT) AS client_id,
                   CAST(e."Cantidad vendida" AS REAL) AS qty,
                   CAST(e."Segmento de mercado o canal" AS TEXT) AS market_code,
                   CAST(e."Indicador de promocioón" AS TEXT) AS source_flag,
                   NULL AS invoice_doc,
                   NULL AS order_or_ref,
                   'excel' AS source
            FROM excel_sales e
            WHERE NOT EXISTS (
              SELECT 1 FROM fact_sales c
              WHERE strftime('%Y-%m-%d %H:%M:%S', c.sale_datetime) = strftime('%Y-%m-%d %H:%M:%S', e."Fecha y hora de venta")
                AND c.sku = substr('000000000'||CAST(e."SKU" AS TEXT), -9, 9)
                AND c.client_id = CAST(e."Cliente" AS TEXT)
            );

            DROP VIEW IF EXISTS dq_conflicts_sales;
            CREATE VIEW dq_conflicts_sales AS
            SELECT * FROM sales_join WHERE join_status = 'conflict_qty';

            DROP VIEW IF EXISTS dq_duplicates_sales;
            CREATE VIEW dq_duplicates_sales AS
            SELECT * FROM sales_join WHERE join_status = 'dup_equal';

            DROP VIEW IF EXISTS dq_left_out_sales;
            CREATE VIEW dq_left_out_sales AS
            SELECT * FROM dq_conflicts_sales
            UNION ALL
            SELECT * FROM dq_duplicates_sales;
            """)

    finally:
        conn.commit()
        conn.close()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True, help='Directory with source files')
    ap.add_argument('--output', required=True, help='Output directory')
    args = ap.parse_args()

    in_dir = Path(args.input)
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    # CSV sources
    venta_df = robust_read_csv(in_dir / 'Venta 15 al 24.csv')
    devol_df = robust_read_csv(in_dir / 'devolucion 15 al 24.csv')
    client_df = robust_read_csv(in_dir / 'clientes 15 al 24.csv')

    dim_client = build_dim_client(client_df)
    fact_sales = build_fact_sales(venta_df)
    fact_returns = build_fact_returns(devol_df)

    # Excel (optional)
    excel_tables = {}
    xlsx = in_dir / 'Envio de datos a Condor.xlsx'
    if xlsx.exists():
        xls = pd.ExcelFile(xlsx)
        if 'Datos maestro de producto' in xls.sheet_names:
            pm = xls.parse('Datos maestro de producto', dtype=str).copy()
            if 'SKU' in pm.columns:
                pm['sku'] = pm['SKU'].map(zpad_sku)
                pm = pm.drop(columns=['SKU'])
            excel_tables['dim_product_master'] = pm
        if 'Datos de venta' in xls.sheet_names:
            es = xls.parse('Datos de venta', dtype=str).copy()
            excel_tables['excel_sales'] = es

    # Outputs: normalized CSVs
    (out_dir/'dim_client.csv').write_text(dim_client.to_csv(index=False), encoding='utf-8')
    (out_dir/'fact_sales.csv').write_text(fact_sales.to_csv(index=False), encoding='utf-8')
    (out_dir/'fact_returns.csv').write_text(fact_returns.to_csv(index=False), encoding='utf-8')
    for name, df in excel_tables.items():
        (out_dir/f'{name}.csv').write_text(df.to_csv(index=False), encoding='utf-8')

    # SQLite SSOT + views
    db_path = out_dir/'ssot.db'
    tables_to_sqlite(db_path, {'dim_client': dim_client, 'fact_sales': fact_sales, 'fact_returns': fact_returns, **excel_tables})

    # Profile + counters
    prof = {
        'sales_rows': int(len(fact_sales)),
        'returns_rows': int(len(fact_returns)),
        'clients_rows': int(len(dim_client)),
        'sales_date_min': str(pd.to_datetime(fact_sales['sale_datetime'], errors='coerce').min()),
        'sales_date_max': str(pd.to_datetime(fact_sales['sale_datetime'], errors='coerce').max()),
        'returns_date_min': str(pd.to_datetime(fact_returns['return_datetime'], errors='coerce').min()),
        'returns_date_max': str(pd.to_datetime(fact_returns['return_datetime'], errors='coerce').max()),
        'unique_skus_in_sales': int(fact_sales['sku'].nunique()),
        'unique_clients_in_sales': int(fact_sales['client_id'].nunique())
    }

    if 'excel_sales' in excel_tables:
        con = sqlite3.connect(str(db_path))
        try:
            csv_n = con.execute('SELECT COUNT(*) FROM fact_sales').fetchone()[0]
            xls_n = con.execute('SELECT COUNT(*) FROM excel_sales').fetchone()[0]
            conf_n = con.execute('SELECT COUNT(*) FROM dq_conflicts_sales').fetchone()[0]
            dup_n = con.execute('SELECT COUNT(*) FROM dq_duplicates_sales').fetchone()[0]
            left_n = con.execute('SELECT COUNT(*) FROM dq_left_out_sales').fetchone()[0]
        finally:
            con.close()
        total_inputs = csv_n + xls_n
        prof.update({
            'inputs_total': int(total_inputs),
            'inputs_csv': int(csv_n),
            'inputs_excel': int(xls_n),
            'left_out_due_to_conflict': int(conf_n),
            'left_out_due_to_duplicate_equal': int(dup_n),
            'left_out_total': int(left_n),
            'left_out_pct_of_all_inputs': float(round(100.0*left_n/total_inputs, 4)) if total_inputs else 0.0,
            'left_out_pct_of_excel_inputs': float(round(100.0*left_n/xls_n, 4)) if xls_n else 0.0
        })

    (out_dir/'profile.json').write_text(json.dumps(prof, indent=2, ensure_ascii=False), encoding='utf-8')

    print('SSOT built at:', db_path)
    print('Outputs in   :', out_dir)

if __name__ == '__main__':
    main()
