from dagster import op, Out, In, Nothing, graph
import pandas as pd
from sqlalchemy import text
import boto3
from io import StringIO
from datetime import datetime, timedelta
import random
import numpy as np

@op(
    name="extract_from_odoo",
    description="Fetches incremental data from Odoo API and a random overlap for paranoia check.",
    out={"incremental_data": Out(), "paranoia_data": Out()},
    required_resource_keys={"odoo", "db"}
)
def extract_from_odoo_op(context):
    odoo = context.resources.odoo
    engine = context.resources.db
    
    # High-water mark from audit
    with engine.connect() as conn:
        result = conn.execute(text("SELECT MAX(last_extracted) FROM extraction_audit"))
        last_run = result.scalar() or datetime.now() - timedelta(days=30)  # Default fallback
        conn.commit()
    
    # NOTE: Real Odoo XML-RPC calls are wired below (uncomment when credentials are live).
    # Incremental fetch from Odoo (uncomment for production):
    #   incremental_data = odoo.execute("sale.order", "search_read",
    #                                   [["create_date", ">", last_run.isoformat()]],
    #                                   {"fields": ["partner_id", "product_id", "qty_delivered",
    #                                               "create_date", "inventory_level"]})
    #   random_date = (datetime.now() - timedelta(days=random.randint(1, 30))).strftime("%Y-%m-%d")
    #   paranoia_data = odoo.execute("sale.order", "search_read",
    #                                [["create_date", ">=", f"{random_date} 00:00:00"],
    #                                 ["create_date", "<=", f"{random_date} 23:59:59"]],
    #                                {"fields": ["partner_id", "product_id", "qty_delivered",
    #                                            "create_date", "inventory_level"]})

    # Simulated data (dev/staging only – replace with Odoo block above in production):
    np.random.seed(int(context.run_id.split('-')[0]) % 2**32)  # Deterministic per run
    n_inc = np.random.poisson(100)  # ~100 records/day

    # inventory_level is included so the Census Filter can identify stock-out periods.
    incremental_data = [
        {
            'partner_id': np.random.randint(1, 500),
            'product_id': np.random.randint(1, 20000),
            'qty_delivered': np.random.poisson(5),
            # ~15 % of records simulate a stock-out (inventory <= 0)
            'inventory_level': 0 if np.random.random() < 0.15 else np.random.randint(1, 200),
            'create_date': (datetime.now() - timedelta(days=np.random.randint(1, 7))).isoformat(),
        }
        for _ in range(n_inc)
    ]
    random_date = datetime.now() - timedelta(days=random.randint(1, 30))
    paranoia_data = [
        {
            'partner_id': np.random.randint(1, 500),
            'product_id': np.random.randint(1, 20000),
            'qty_delivered': np.random.poisson(5),
            'inventory_level': np.random.randint(0, 200),
            'create_date': random_date.isoformat(),
        }
        for _ in range(np.random.poisson(50))
    ]

    context.log.info(f"Extracted {len(incremental_data)} inc records; {len(paranoia_data)} paranoia records")
    return incremental_data, paranoia_data

@op(
    name="transform_and_reconcile",
    description="Applies business rules, validates paranoia check data, and separates invalid records.",
    ins={"incremental_data": In(), "paranoia_data": In()},
    out={"clean_data": Out(), "skipped_records": Out(), "paranoia_mismatch": Out()},
    required_resource_keys={"db"}
)
def transform_and_reconcile_op(context, incremental_data, paranoia_data):
    engine = context.resources.db
    
    # Paranoia check: Query overlapping day from DB
    random_date_str = pd.to_datetime(paranoia_data[0]['create_date'] if paranoia_data else datetime.now()).strftime("%Y-%m-%d")
    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT partner_id, product_id, qty_delivered, create_date 
            FROM sales_trans 
            WHERE DATE(create_date) = :date
        """), {"date": random_date_str})
        existing_db_data = result.fetchall()
        conn.commit()
    
    df_inc = pd.DataFrame(incremental_data)
    df_para = pd.DataFrame(paranoia_data)
    df_db = pd.DataFrame(existing_db_data, columns=["partner_id", "product_id", "qty_delivered", "create_date"])
    
    # Validate paranoia (full join + sum mismatch)
    merged = df_para.merge(df_db, on=["partner_id", "product_id"], how="outer", suffixes=("_para", "_db"))
    mismatch_cols = merged[['qty_delivered_para', 'qty_delivered_db']].fillna(0)
    paranoia_mismatch = not mismatch_cols['qty_delivered_para'].equals(mismatch_cols['qty_delivered_db'])
    context.log.info(f"Paranoia mismatch: {paranoia_mismatch}")
    
    # Transform: Apply rules from Kirby D (outlier IQR, TZ normalize, etc.)
    df_inc['create_date'] = pd.to_datetime(df_inc['create_date']).dt.tz_localize('UTC')

    # ── CENSUS FILTER (Phase 1 – BSTS Imputation Validation) ─────────────────
    # When inventory_level <= 0 AND qty_delivered == 0, the recorded zero is NOT
    # a true zero-demand signal – it is a *censored* observation caused by a
    # stock-out.  Loading these as real zeros would bias the demand model
    # downward.  We mark them as NaN (missing / censored) and exclude them from
    # the clean_data that feeds ML training; they are logged separately so the
    # Bayesian model can widen its uncertainty intervals around these periods.
    inventory_col = 'inventory_level' if 'inventory_level' in df_inc.columns else None
    if inventory_col:
        censored_mask = (df_inc[inventory_col].fillna(999) <= 0) & (df_inc['qty_delivered'] == 0)
    else:
        # Fallback when inventory data is unavailable: no censoring
        censored_mask = pd.Series(False, index=df_inc.index)
        context.log.warning("Census Filter: inventory_level column absent – censoring skipped.")

    censored_df = df_inc[censored_mask].copy()
    censored_df['imputation_reason'] = (
        'CENSUS_FILTER: inventory<=0 with zero sales; '
        'demand is NaN (censored), not a true zero.'
    )
    censored_df['qty_delivered'] = float('nan')  # NaN = censored signal
    context.log.info(f"Census Filter: {len(censored_df)} records censored (stock-out periods).")

    # Remove censored records from the pipeline before IQR and loading
    df_inc = df_inc[~censored_mask]
    # ─────────────────────────────────────────────────────────────────────────

    # Outlier skip (IQR)
    Q1 = df_inc['qty_delivered'].quantile(0.25)
    Q3 = df_inc['qty_delivered'].quantile(0.75)
    IQR = Q3 - Q1
    df_clean = df_inc[
        (df_inc['qty_delivered'] >= (Q1 - 1.5 * IQR)) &
        (df_inc['qty_delivered'] <= (Q3 + 1.5 * IQR))
    ]
    iqr_skipped = df_inc[~df_inc.index.isin(df_clean.index)]

    # Merge IQR-skipped with censored into a single skipped_records list
    skipped_records = (
        iqr_skipped.to_dict('records') +
        censored_df.assign(skip_reason='IQR_OUTLIER' if not censored_df.empty else 'CENSUS_FILTER')
                   .to_dict('records')
    )

    context.log.info(f"Clean: {len(df_clean)}, Skipped (IQR): {len(iqr_skipped)}, Censored: {len(censored_df)}")
    return df_clean.to_dict('records'), skipped_records, paranoia_mismatch

@op(
    name="load_to_aurora",
    description="Bulk-inserts clean, validated data into the Aurora PostgreSQL database.",
    ins={"clean_data": In()},
    required_resource_keys={"db"}
)
def load_to_aurora_op(context, clean_data):
    engine = context.resources.db
    if not clean_data:
        context.log.info("No clean data to load")
        return None
    
    df = pd.DataFrame(clean_data)
    df['load_ts'] = pd.Timestamp.now()
    
    chunk_size = 10000
    total_inserted = 0
    for i in range(0, len(df), chunk_size):
        chunk = df.iloc[i:i+chunk_size]
        chunk.to_sql('sales_trans', engine, if_exists='append', index=False, method='multi')
        total_inserted += len(chunk)
        context.log.info(f"Inserted batch: {len(chunk)} rows")
    
    with engine.connect() as conn:
        conn.execute(text("INSERT INTO extraction_audit (last_extracted) VALUES (NOW()) ON CONFLICT (id) DO UPDATE SET last_extracted = NOW()"))
        conn.commit()
    
    context.log.info(f"Total loaded: {total_inserted} records")
    return None

@op(
    name="report_anomalies",
    description="Generates and sends technical reports for skipped records and paranoia check failures.",
    ins={
        "skipped_records": In(),
        "paranoia_mismatch": In(),
        "load_confirmation": In(dagster_type=Nothing)
    },
    required_resource_keys={"sns", "db"}
)
def report_anomalies_op(context, skipped_records, paranoia_mismatch):
    if not paranoia_mismatch and not skipped_records:
        context.log.info("No anomalies to report. Pipeline run was clean.")
        return

    alerts = []
    subject = f"AI Refill ETL Report for {datetime.now().strftime('%Y-%m-%d')}: "
    if paranoia_mismatch:
        subject += "ACTION REQUIRED"
        alerts.append("CRITICAL: Paranoia Check FAILED. Record count mismatch between source and destination.")
    if skipped_records:
        alert = "WARNING" if not paranoia_mismatch else ""
        if alert:
            subject += alert
        alerts.append(f"INFO: Skipped {len(skipped_records)} records due to business rule violations.")
        for record in skipped_records[:10]:
            alerts.append(f" - Record: {str(record)}")

    message = "\n".join(alerts)
    sns_client = context.resources.sns
    topic_arn = sns_client.topic_arn  # Modern access
    try:
        sns_client.publish(TopicArn=topic_arn, Message=message, Subject=subject)
        context.log.info("Anomaly report sent successfully via SNS.")
    except Exception as e:
        context.log.error(f"Failed to send SNS report: {e}")
        raise

    # Audit per SSOT (use db resource)
    engine = context.resources.db
    with engine.connect() as conn:
        conn.execute(text("""
            INSERT INTO audit_logs (run_status, records_processed, records_skipped, significant_events)
            VALUES ('reported', 0, :skipped, :events)
        """), {"skipped": len(skipped_records), "events": str(paranoia_mismatch)})
        conn.commit()

@graph(
    name="ingestion_and_reconciliation_graph",
    description="The main ETL graph for fetching, processing, and storing AI Refill data."
)
def ingestion_and_reconciliation_graph():
    incremental_data, paranoia_data = extract_from_odoo_op()
    
    clean_data, skipped_records, paranoia_mismatch = transform_and_reconcile_op(
        incremental_data=incremental_data,
        paranoia_data=paranoia_data
    )
    
    load_confirmation = load_to_aurora_op(clean_data=clean_data)
    
    report_anomalies_op(
        skipped_records=skipped_records,
        paranoia_mismatch=paranoia_mismatch,
        load_confirmation=load_confirmation
    )