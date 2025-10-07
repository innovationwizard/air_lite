# kirby_C.py
import pandas as pd

def build_unified(*, txt_file, clients_csv, returns_csv, sales_csv, excel_file):
    """
    Loads all sources and returns (dfs, unified_df).
    """
    pd.set_option('future.no_silent_downcasting', True)

    df_txt     = parse_txt(txt_file)
    df_clients = clean_clients(clients_csv)
    df_returns = clean_returns(returns_csv)
    df_sales   = clean_sales(sales_csv)
    df_excel   = clean_excel(excel_file)

    if all(d.empty for d in [df_txt, df_clients, df_returns, df_sales, df_excel]):
        return [], pd.DataFrame()

    dfs = [
        df_txt,
        df_clients.rename(columns={'client_id': 'client'}),
        df_returns.rename(columns={'client_id': 'client'}),
        df_sales.rename(columns={'client_id': 'client'}),
        df_excel.rename(columns={'client': 'client', 'seller': 'seller'}),
    ]
    all_cols = set().union(*(d.columns for d in dfs))
    dfs = [d.reindex(columns=all_cols, fill_value='') for d in dfs]

    unified_df = pd.concat(dfs, ignore_index=True, sort=False).fillna('').astype(str)
    return dfs, unified_df

def main():
    """
    Preserves CLI behavior (insert to Postgres) but requires explicit paths.
    Provide them via env vars or constants if you still keep them.
    """
    import os
    # Prefer env vars; fall back to module-level constants if they exist.
    paths = {
    "txt_file": 'HIGH LEVEL DESCRIPTION.TXT',
    "clients_csv": 'clientes 15 al 24.csv',
    "returns_csv": 'devolucion 15 al 24.csv',
    "sales_csv": 'Venta 15 al 24.csv',
    "excel_file": 'Envio de datos a Condor.xlsx'
    }
    missing = [k for k, v in paths.items() if not v]
    if missing:
        print(f"Missing required paths: {', '.join(missing)}")
        return

    _, unified_df = build_unified(**paths)
    if unified_df.empty:
        print("No data ingested; check files.")
        return

    # Requires TABLE_NAME and DB_PARAMS (env or globals).
    table_name = os.getenv("TABLE_NAME", globals().get("TABLE_NAME"))
    db_params  = globals().get("DB_PARAMS")
    if not table_name or not db_params:
        print("Skipping DB insert: TABLE_NAME or DB_PARAMS not set.")
        return

    insert_to_postgres(unified_df, table_name, db_params)

if __name__ == '__main__':
    main()
