import pandas as pd
import numpy as np
from datetime import datetime
import psycopg2
from psycopg2 import sql
import os

# Configurable paths (update or place files in dir)
TXT_FILE = 'HIGH LEVEL DESCRIPTION.TXT'
CLIENTS_CSV = 'clientes 15 al 24.csv'
RETURNS_CSV = 'devolucion 15 al 24.csv'
SALES_CSV = 'Venta 15 al 24.csv'
EXCEL_FILE = 'Envio de datos a Condor.xlsx'

# Postgres params: Update 'user' to 'jorgeluiscontrerasherrera'; 'password' blank if none
DB_PARAMS = {
    'dbname': 'ai_refill',
    'user': 'c',
    'password': 'x',
    'host': 'localhost',
    'port': '5432'
}

TABLE_NAME = 'unified_knowledge'

def log_cleaning_stats(df_name, orig_rows, clean_rows):
    dropped = orig_rows - clean_rows
    pct = (dropped / orig_rows * 100) if orig_rows > 0 else 0
    print(f"{df_name}: Orig {orig_rows}, Clean {clean_rows}, Drop {dropped}, Pct drop {pct:.2f}%")

def parse_txt(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            text = f.read()
        sections = {'summary': text.split('SUMMARY:')[1].split('HIGH LEVEL DESCRIPTION:')[0].strip() if 'SUMMARY:' in text else '',
                    'description': text.split('HIGH LEVEL DESCRIPTION:')[1].strip() if 'HIGH LEVEL DESCRIPTION:' in text else ''}
        df = pd.DataFrame([sections])
        df['source'] = 'project_desc'
        orig = len(df)
        log_cleaning_stats('TXT', orig, len(df))
        return df
    except FileNotFoundError:
        print(f"Error: {file_path} not found.")
        return pd.DataFrame()

def clean_clients(file_path):
    try:
        df = pd.read_csv(file_path, header=None, names=['client_id', 'client_name'], on_bad_lines='warn', dtype=str)
        orig = len(df)
        df = df.drop_duplicates()
        df = df[~df['client_name'].str.contains('NO USAR|sdafa|asdfasdf|sd|hgf|PRUEBA', na=False, regex=True)]
        df['client_id'] = df['client_id'].str.strip()
        df['client_name'] = df['client_name'].str.strip()
        df['source'] = 'clients'
        log_cleaning_stats('Clients CSV', orig, len(df))
        return df
    except FileNotFoundError:
        print(f"Error: {file_path} not found.")
        return pd.DataFrame()

def clean_returns(file_path):
    try:
        df = pd.read_csv(file_path, header=None, names=['amount', 'qty', 'price', 'client_id', 'sku', 'product', 'date', 'market', 'nc_code', 'reason', 'col10', 'col11'], on_bad_lines='warn', dtype=str)
        orig = len(df)
        df = df.drop_duplicates()
        df['date'] = pd.to_datetime(df['date'], errors='coerce')
        df = df.dropna(subset=['date'])
        df[['amount', 'qty', 'price']] = df[['amount', 'qty', 'price']].apply(pd.to_numeric, errors='coerce')
        df['sku'] = df['sku'].str.zfill(9)
        df['source'] = 'returns'
        df = df.drop(columns=['col10', 'col11'])
        log_cleaning_stats('Returns CSV', orig, len(df))
        return df
    except FileNotFoundError:
        print(f"Error: {file_path} not found.")
        return pd.DataFrame()

def clean_sales(file_path):
    try:
        df = pd.read_csv(file_path, header=None, names=['col0', 'qty', 'price', 'unit_price', 'col4', 'col5', 'client_id', 'sku', 'product', 'date', 'col9', 'market', 'ff_code', 'col13', 'col14', 'col15'], on_bad_lines='warn', dtype=str)
        orig = len(df)
        df = df.drop_duplicates()
        df['date'] = pd.to_datetime(df['date'], errors='coerce')
        df = df.dropna(subset=['date'])
        df[['qty', 'price', 'unit_price']] = df[['qty', 'price', 'unit_price']].apply(pd.to_numeric, errors='coerce')
        df['sku'] = df['sku'].str.zfill(9)
        df['source'] = 'sales'
        df = df.drop(columns=['col0', 'col4', 'col5', 'col9', 'col13', 'col14', 'col15'])
        log_cleaning_stats('Sales CSV', orig, len(df))
        return df
    except FileNotFoundError:
        print(f"Error: {file_path} not found.")
        return pd.DataFrame()

def clean_excel(file_path):
    try:
        xls = pd.ExcelFile(file_path)
        
        # Sheet 0: Product Master
        df_prod = pd.read_excel(xls, sheet_name=0, header=0)
        orig_prod = len(df_prod)
        df_prod['sku'] = df_prod['SKU'].astype(str).str.zfill(9)
        df_prod['source'] = 'product_master'
        log_cleaning_stats('Excel Product Master', orig_prod, len(df_prod))
        
        # Sheet 1: Sales
        df_sales = pd.read_excel(xls, sheet_name=1, header=0)
        orig_sales = len(df_sales)
        if not pd.api.types.is_datetime64_any_dtype(df_sales['Fecha y hora de venta']):
            df_sales['Fecha y hora de venta'] = pd.to_datetime(df_sales['Fecha y hora de venta'], errors='coerce')
        df_sales['SKU'] = df_sales['SKU'].astype(str).str.zfill(9)
        df_sales['source'] = 'excel_sales'
        df_sales = df_sales.fillna({'Devoluciones': 0, 'Venta perdida': 0})
        log_cleaning_stats('Excel Sales', orig_sales, len(df_sales))
        
        # Sheet 2: Sellers
        df_sellers = pd.read_excel(xls, sheet_name=2, header=0, names=['seller', 'category'])
        orig_sellers = len(df_sellers)
        df_sellers['source'] = 'sellers'
        log_cleaning_stats('Excel Sellers', orig_sellers, len(df_sellers))
        
        # Sheet 3: Returns Monthly (custom unpivot for suffixed cols)
        df_returns_monthly = pd.read_excel(xls, sheet_name=3, header=1)
        orig_returns = len(df_returns_monthly)
        print("Returns Monthly columns:", df_returns_monthly.columns.tolist())  # Debug
        suffixes = ['', '.1', '.2', '.3', '.4', '.5', '.6', '.7', '.8', '.9', '.10', '.11', '.12']  # Base + 12
        melted_dfs = []
        for suffix in suffixes:
            cols = [f'Cantidad Original{suffix}', f'Cantidad Entregada{suffix}', f'Cantidad Devuelta{suffix}']
            if all(col in df_returns_monthly.columns for col in cols):
                df_temp = df_returns_monthly[['Producto', 'Vendedor', 'Cliente']].copy()
                df_temp['original'] = df_returns_monthly[f'Cantidad Original{suffix}']
                df_temp['entregada'] = df_returns_monthly[f'Cantidad Entregada{suffix}']
                df_temp['devuelta'] = df_returns_monthly[f'Cantidad Devuelta{suffix}']
                df_temp['suffix'] = suffix  # Temp for month mapping if needed
                melted_dfs.append(df_temp)
        if melted_dfs:
            df_returns_monthly = pd.concat(melted_dfs, ignore_index=True)
            df_returns_monthly['source'] = 'returns_monthly'
            df_returns_monthly = df_returns_monthly.fillna(0)
        else:
            df_returns_monthly = pd.DataFrame()
        log_cleaning_stats('Excel Returns Monthly', orig_returns, len(df_returns_monthly))
        
        # Sheet 4: Inventory
        df_inv = pd.read_excel(xls, sheet_name=4, header=0)
        orig_inv = len(df_inv)
        if not pd.api.types.is_datetime64_any_dtype(df_inv['Fecha y hora']):
            df_inv['Fecha y hora'] = pd.to_datetime(df_inv['Fecha y hora'], errors='coerce')
        df_inv['SKU'] = df_inv['SKU'].astype(str).str.zfill(9)
        df_inv = df_inv.fillna(0)
        df_inv['source'] = 'inventory'
        log_cleaning_stats('Excel Inventory', orig_inv, len(df_inv))
        
        # Sheet 5: Purchases
        df_purch = pd.read_excel(xls, sheet_name=5, header=0)
        orig_purch = len(df_purch)
        if not pd.api.types.is_datetime64_any_dtype(df_purch['Fecha de orden de compra']):
            df_purch['Fecha de orden de compra'] = pd.to_datetime(df_purch['Fecha de orden de compra'], errors='coerce')
        if not pd.api.types.is_datetime64_any_dtype(df_purch['Fecha de esperada']):
            df_purch['Fecha de esperada'] = pd.to_datetime(df_purch['Fecha de esperada'], errors='coerce')
        df_purch['SKU'] = df_purch['SKU'].astype(str).str.zfill(9)
        df_purch = df_purch.fillna({'Historial del estado pedido': ''})
        df_purch['source'] = 'purchases'
        log_cleaning_stats('Excel Purchases', orig_purch, len(df_purch))
        
        # Concat all Excel DFs
        common_cols = ['sku', 'date', 'qty', 'price', 'client', 'seller', 'source']
        all_dfs = [df_prod, df_sales.rename(columns={'Fecha y hora de venta': 'date', 'Cantidad vendida': 'qty', 'Cliente': 'client', 'Vendedor': 'seller', 'SKU': 'sku'}),
                   df_sellers, df_returns_monthly.rename(columns={'Producto': 'sku', 'Cliente': 'client', 'Vendedor': 'seller'}),
                   df_inv.rename(columns={'Fecha y hora': 'date', 'Nivel de inventario disponible': 'qty', 'SKU': 'sku'}),
                   df_purch.rename(columns={'Fecha de orden de compra': 'date', 'Cantidad solicitada': 'qty', 'Proveedor': 'seller', 'SKU': 'sku'})]
        df_excel = pd.concat(all_dfs, ignore_index=True, sort=False)
        return df_excel
    except FileNotFoundError:
        print(f"Error: {file_path} not found.")
        return pd.DataFrame()

def insert_to_postgres(df, table_name, conn_params):
    conn = psycopg2.connect(**conn_params)
    cur = conn.cursor()
    # Create table if not exists (dynamic columns)
    cols = df.columns.tolist()
    col_defs = ', '.join([f'"{col}" TEXT' for col in cols])  # All text for simplicity
    create_query = sql.SQL(f"CREATE TABLE IF NOT EXISTS {table_name} ({col_defs});")
    cur.execute(create_query)
    
    # Insert data
    dropped_inserts = 0
    for idx, row in df.iterrows():
        row = row.fillna('')
        values = tuple(row[col] for col in cols)
        if len(values) != len(cols):
            print(f"Mismatch in row {idx}: expected {len(cols)}, got {len(values)}. Skipping.")
            dropped_inserts += 1
            continue
        insert_query = sql.SQL(f"INSERT INTO {table_name} ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))});")
        cur.execute(insert_query, values)
    
    conn.commit()
    cur.close()
    conn.close()
    print(f"Data inserted into Postgres table '{table_name}' (rows: {len(df) - dropped_inserts}, dropped inserts: {dropped_inserts})")

def main():
    pd.set_option('future.no_silent_downcasting', True)  # Suppress FutureWarning
    df_txt = parse_txt(TXT_FILE)
    df_clients = clean_clients(CLIENTS_CSV)
    df_returns = clean_returns(RETURNS_CSV)
    df_sales = clean_sales(SALES_CSV)
    df_excel = clean_excel(EXCEL_FILE)
    
    if all(d.empty for d in [df_txt, df_clients, df_returns, df_sales, df_excel]):
        print("No data ingested; check files.")
        return

    dfs = [df_txt, df_clients.rename(columns={'client_id': 'client'}), 
           df_returns.rename(columns={'client_id': 'client'}), 
           df_sales.rename(columns={'client_id': 'client'}),
           df_excel.rename(columns={'client': 'client', 'seller': 'seller'})]
    all_cols = set().union(*(d.columns for d in dfs))
    for i in range(len(dfs)):
        dfs[i] = dfs[i].reindex(columns=all_cols, fill_value='')
    unified_df = pd.concat(dfs, ignore_index=True, sort=False)
    unified_df = unified_df.fillna('')
    unified_df = unified_df.astype(str)
    
    insert_to_postgres(unified_df, TABLE_NAME, DB_PARAMS)

if __name__ == '__main__':
    main()