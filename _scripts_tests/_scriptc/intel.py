import os
import pandas as pd
from kirby_C import build_unified

def main():
    # Set your actual paths here (or pull from env)
    paths = {
    "txt_file": 'HIGH LEVEL DESCRIPTION.TXT',
    "clients_csv": 'clientes 15 al 24.csv',
    "returns_csv": 'devolucion 15 al 24.csv',
    "sales_csv": 'Venta 15 al 24.csv',
    "excel_file": 'Envio de datos a Condor.xlsx'
    }
    missing = [k for k, v in paths.items() if not v or not os.path.exists(v)]
    if missing:
        print(f"Fix these paths first (missing or not found): {', '.join(missing)}")
        for k, v in paths.items():
            print(f"{k} = {v}")
        return

    dfs, unified_df = build_unified(**paths)
    if not dfs or unified_df.empty:
        print("No data to analyze; all sources are empty.")
        return

    # ---- your existing analysis code (unchanged) ----
    all_cols = set().union(*(d.columns for d in dfs))
    expected_num_cols = len(all_cols)
    print(f"Expected number of columns: {expected_num_cols}")

    match_count = 0
    non_match_count = 0
    diffs = []
    non_na_counts = unified_df.notna().sum(axis=1)

    for idx, non_na_count in non_na_counts.items():
        if non_na_count == expected_num_cols:
            match_count += 1
        else:
            non_match_count += 1
            diff = non_na_count - expected_num_cols
            diffs.append(diff)
            print(f"Row {idx} diff: {diff} ({'more' if diff > 0 else 'fewer'})")

    print(f"Records matching expected columns: {match_count}")
    print(f"Records not matching: {non_match_count}")
    if non_match_count > 0:
        avg_diff = sum(diffs) / len(diffs)
        print(f"Avg diff: {avg_diff} ({'more' if avg_diff > 0 else 'fewer'})")

    unified_df['num_cols'] = non_na_counts
    col_counts = unified_df['num_cols'].value_counts()
    print("Records per column count:", col_counts.to_dict())

    unique_col_nums = col_counts.index.tolist()
    if len(unique_col_nums) > 1:
        for num in unique_col_nums:
            df_split = unified_df[unified_df['num_cols'] == num].drop(columns=['num_cols'])
            outname = f'split_{num}_cols.csv'
            df_split.to_csv(outname, index=False)
            print(f"Saved split with {num} cols to {outname}")

    dup_cols = unified_df.columns[unified_df.columns.duplicated()].tolist()
    print("Duplicate columns: ", dup_cols)

    na_pct = unified_df.isna().mean() * 100
    print("NaN % per col:", na_pct.to_dict())

    print("Dtypes:", unified_df.drop(columns=['num_cols'], errors='ignore').dtypes.to_dict())
    print("Sample rows:", unified_df.head(5).to_dict())

if __name__ == "__main__":
    main()
