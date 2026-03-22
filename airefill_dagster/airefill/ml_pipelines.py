from dagster import op, graph, Out, In, Nothing
import pandas as pd 
import joblib
import tarfile
from urllib.parse import urlparse
from sklearn.metrics import mean_squared_error
from sklearn.model_selection import train_test_split 
import io
from datetime import datetime, timedelta
import boto3
from airefill.inventory_optimization import batch_calculate_params, forecast_metric, calculate_reorder_point_and_safety_stock

# Helper function (extracted for reuse)
def load_model_from_s3(s3_client, model_s3_path: str):
    """Download and load Prophet model from S3 tar.gz."""
    parsed_url = urlparse(model_s3_path)
    bucket, key = parsed_url.netloc, parsed_url.path.lstrip('/')
    local_tar_path = f"/tmp/{key.split('/')[-1]}"
    s3_client.download_file(bucket, key, local_tar_path)
    with tarfile.open(local_tar_path, "r:gz") as tar:
        tar.extractall("/tmp/model")
    return joblib.load("/tmp/model/model.joblib")

def _load_latest_model(context, group_name: str):
    """Load latest approved model from registry group."""
    sagemaker_client = context.resources.sagemaker
    s3_client = context.resources.s3
    try:
        approved_packages = sagemaker_client.list_model_packages(
            ModelPackageGroupName=group_name,
            ModelApprovalStatus="Approved",
            SortBy="CreationTime",
            SortOrder="Descending",
            MaxResults=1,
        )
        if not approved_packages["ModelPackageSummaryList"]:
            raise ValueError("No approved model available")
        latest_model_artifact = sagemaker_client.describe_model_package(
            ModelPackageName=approved_packages["ModelPackageSummaryList"][0]["ModelPackageArn"]
        )['InferenceSpecification']['Containers'][0]['ModelDataUrl']
        return load_model_from_s3(s3_client, latest_model_artifact)
    except Exception as e:
        context.log.error(f"Failed to load model from {group_name}: {e}")
        raise

def _evaluate_promote_single(context, artifact_path: str, val_path: str, group_name: str):
    """Evaluate and promote single model."""
    sagemaker_client = context.resources.sagemaker
    s3_client = context.resources.s3

    # Register new model pending
    model_package_response = sagemaker_client.create_model_package(
        ModelPackageGroupName=group_name,
        ModelPackageDescription=f"Prophet {group_name.split('-')[-1]} forecasting model",
        ModelApprovalStatus="PendingApproval",
        InferenceSpecification={
            "Containers": [{
                "Image": "683313688378.dkr.ecr.us-east-2.amazonaws.com/sagemaker-scikit-learn:1.2-1-cpu-py3",
                "ModelDataUrl": artifact_path,
            }],
            "SupportedContentTypes": ["text/csv"],
            "SupportedResponseMIMETypes": ["application/json"],
        }
    )
    new_model_package_arn = model_package_response["ModelPackageArn"]
    context.log.info(f"Registered new {group_name} model: {new_model_package_arn}")

    # Find prod model
    prod_model_package_arn = None
    try:
        approved_packages = sagemaker_client.list_model_packages(
            ModelPackageGroupName=group_name,
            ModelApprovalStatus="Approved",
            SortBy="CreationTime",
            SortOrder="Descending",
            MaxResults=1,
        )
        if approved_packages["ModelPackageSummaryList"]:
            prod_model_package_arn = approved_packages["ModelPackageSummaryList"][0]["ModelPackageArn"]
    except Exception as e:
        context.log.warning(f"Could not find prod {group_name} model: {e}")

    # Load validation data
    val_parsed_url = urlparse(val_path)
    val_bucket, val_key = val_parsed_url.netloc, val_parsed_url.path.lstrip('/')
    val_obj = s3_client.get_object(Bucket=val_bucket, Key=val_key)
    val_df = pd.read_csv(io.BytesIO(val_obj['Body'].read()))
    val_df.rename(columns={'ds': 'ds', 'y': 'y'}, inplace=True)  # Ensure columns

    # Load models
    new_model = load_model_from_s3(s3_client, artifact_path)
    prod_model = None
    if prod_model_package_arn:
        prod_model_artifact_path = sagemaker_client.describe_model_package(
            ModelPackageName=prod_model_package_arn
        )['InferenceSpecification']['Containers'][0]['ModelDataUrl']
        prod_model = load_model_from_s3(s3_client, prod_model_artifact_path)

    # Evaluate
    new_forecast = new_model.predict(val_df[['ds']])
    new_rmse = mean_squared_error(val_df['y'], new_forecast['yhat'], squared=False)
    context.log.info(f"New {group_name} RMSE: {new_rmse:.4f}")

    promote = True
    if prod_model:
        prod_forecast = prod_model.predict(val_df[['ds']])
        prod_rmse = mean_squared_error(val_df['y'], prod_forecast['yhat'], squared=False)
        context.log.info(f"Prod {group_name} RMSE: {prod_rmse:.4f}")
        if new_rmse >= prod_rmse:
            promote = False

    if promote:
        sagemaker_client.update_model_package(
            ModelPackageArn=new_model_package_arn,
            ModelApprovalStatus="Approved"
        )
        if prod_model_package_arn:
            sagemaker_client.update_model_package(
                ModelPackageArn=prod_model_package_arn,
                ModelApprovalStatus="Archived"
            )
        context.log.info(f"Promoted new {group_name} model.")
    else:
        context.log.warning(f"Did not promote {group_name} model.")
    return promote

@op(
    name="extract_training_data",
    out={"demand_s3_path": Out(str), "leadtime_s3_path": Out(str)},
    required_resource_keys={"db", "s3"},
)
def extract_training_data_op(context):
    s3_bucket = "ai-refill-ml-artifacts"
    run_id = context.run_id

    # Demand — Census Filter applied at query level:
    # Exclude periods where inventory was <= 0 AND sales == 0 (censored observations).
    # These are stock-out periods where the zero is NOT a true demand signal.
    # Prophet interpolates through these gaps; the wider uncertainty intervals
    # naturally reflect the reduced information content (Phase 1 – Prior Anchoring).
    demand_query = """
    SELECT sp.product_id, sp.create_date AS ds, sp.qty_delivered AS y
    FROM sales_partitioned sp
    LEFT JOIN inventory_snapshots inv
           ON sp.product_id = inv.product_id
          AND DATE(sp.create_date) = DATE(inv.snapshot_date)
    WHERE NOT sp.is_deleted
      AND NOT (COALESCE(inv.quantity_on_hand, 999) <= 0 AND sp.qty_delivered = 0)
    ORDER BY sp.product_id, sp.create_date;
    """
    with context.resources.db.connect() as conn:
        demand_df = pd.read_sql_query(demand_query, conn)
    demand_key = f"datasets/raw/demand_{run_id}.csv"
    csv_buffer = io.StringIO()
    demand_df.to_csv(csv_buffer, index=False)
    context.resources.s3.put_object(Bucket=s3_bucket, Key=demand_key, Body=csv_buffer.getvalue())
    demand_path = f"s3://{s3_bucket}/{demand_key}"

    # Lead time
    lt_query = """
    SELECT product_id, order_date as ds, (delivery_date - order_date) as y
    FROM lead_times
    WHERE delivery_date IS NOT NULL AND y > 0
    ORDER BY ds;
    """
    with context.resources.db.connect() as conn:
        lt_df = pd.read_sql_query(lt_query, conn)
    if lt_df.empty:
        context.log.warning("No LT data; fallback used.")
        lt_df = pd.DataFrame({'product_id': [1], 'ds': [pd.Timestamp.now()], 'y': [7.0]})
    lt_key = f"datasets/raw/leadtime_{run_id}.csv"
    csv_buffer = io.StringIO()
    lt_df.to_csv(csv_buffer, index=False)
    context.resources.s3.put_object(Bucket=s3_bucket, Key=lt_key, Body=csv_buffer.getvalue())
    lt_path = f"s3://{s3_bucket}/{lt_key}"

    context.log.info(f"Extracted demand: {len(demand_df)}, LT: {len(lt_df)}")
    return demand_path, lt_path

@op(
    ins={"demand_s3_path": In(str), "leadtime_s3_path": In(str)},
    out={"demand_train_s3": Out(str), "demand_val_s3": Out(str), "lt_train_s3": Out(str), "lt_val_s3": Out(str)},
    required_resource_keys={"s3"},
)
def feature_engineering_op(context, demand_s3_path: str, leadtime_s3_path: str):
    s3_client = context.resources.s3
    bucket = demand_s3_path.replace("s3://", "").split("/")[0]
    run_id = context.run_id

    # Demand
    obj = s3_client.get_object(Bucket=bucket, Key=demand_s3_path.split('/')[-1])
    df = pd.read_csv(io.BytesIO(obj['Body'].read()))
    if len(df) < 5:
        raise ValueError("Insufficient demand data")
    df['ds'] = pd.to_datetime(df['ds'])
    train_d, val_d = train_test_split(df, test_size=0.2, shuffle=False)
    d_train_key = f"datasets/processed/demand_train_{run_id}.csv"
    d_val_key = f"datasets/processed/demand_val_{run_id}.csv"
    for key, df_set in [(d_train_key, train_d), (d_val_key, val_d)]:
        csv_buffer = io.StringIO()
        df_set.to_csv(csv_buffer, index=False)
        s3_client.put_object(Bucket=bucket, Key=key, Body=csv_buffer.getvalue())
    d_train_path = f"s3://{bucket}/{d_train_key}"
    d_val_path = f"s3://{bucket}/{d_val_key}"

    # LT
    obj = s3_client.get_object(Bucket=bucket, Key=leadtime_s3_path.split('/')[-1])
    lt_df = pd.read_csv(io.BytesIO(obj['Body'].read()))
    if len(lt_df) < 5:
        raise ValueError("Insufficient LT data")
    lt_df['ds'] = pd.to_datetime(lt_df['ds'])
    train_lt, val_lt = train_test_split(lt_df, test_size=0.2, shuffle=False)
    lt_train_key = f"datasets/processed/lt_train_{run_id}.csv"
    lt_val_key = f"datasets/processed/lt_val_{run_id}.csv"
    for key, df_set in [(lt_train_key, train_lt), (lt_val_key, val_lt)]:
        csv_buffer = io.StringIO()
        df_set.to_csv(csv_buffer, index=False)
        s3_client.put_object(Bucket=bucket, Key=key, Body=csv_buffer.getvalue())
    lt_train_path = f"s3://{bucket}/{lt_train_key}"
    lt_val_path = f"s3://{bucket}/{lt_val_key}"

    context.log.info(f"FE complete: Demand train {len(train_d)}, val {len(val_d)}; LT train {len(train_lt)}, val {len(val_lt)}")
    return d_train_path, d_val_path, lt_train_path, lt_val_path

@op(
    name="trigger_sagemaker_training",
    ins={"train_s3_path": In(str)},
    out={"model_artifact_s3_path": Out(str)},
    required_resource_keys={"sagemaker"},
)
def trigger_sagemaker_training_op(context, train_s3_path: str):
    sagemaker_client = context.resources.sagemaker
    training_job_name = f"airefill-prophet-demand-training-{context.run_id[:8]}"
    role_arn = "arn:aws:iam::200937443798:role/InfraStack-SageMakerTrainingRoleD9E95376-oB8Jp22ofRei"
    training_image_uri = "683313688378.dkr.ecr.us-east-2.amazonaws.com/sagemaker-scikit-learn:1.2-1-cpu-py3"
    s3_bucket = "ai-refill-ml-artifacts"
    
    context.log.info(f"Starting demand training: {training_job_name}")
    sagemaker_client.create_training_job(
        TrainingJobName=training_job_name,
        AlgorithmSpecification={'TrainingImage': training_image_uri, 'TrainingInputMode': 'File'},
        RoleArn=role_arn,
        InputDataConfig=[{
            'ChannelName': 'train',
            'DataSource': {'S3DataSource': {'S3DataType': 'S3Prefix', 'S3Uri': train_s3_path.rsplit('/', 1)[0] + '/', 'S3DataDistributionType': 'FullyReplicated'}},
            'ContentType': 'text/csv',
        }],
        OutputDataConfig={'S3OutputPath': f's3://{s3_bucket}/models/'},
        ResourceConfig={'InstanceType': 'ml.m5.large', 'InstanceCount': 1, 'VolumeSizeInGB': 10},
        EnableManagedSpotTraining=False,
        HyperParameters={'changepoint_prior_scale': '0.05', 'seasonality_prior_scale': '10.0'},
        StoppingCondition={'MaxRuntimeInSeconds': 3600}
    )
    
    waiter = sagemaker_client.get_waiter('training_job_completed_or_stopped')
    waiter.wait(TrainingJobName=training_job_name)
    job_desc = sagemaker_client.describe_training_job(TrainingJobName=training_job_name)
    if job_desc['TrainingJobStatus'] != 'Completed':
        raise Exception(f"Demand training failed: {job_desc['FailureReason']}")
    
    model_artifact_s3_path = f"{job_desc['OutputDataConfig']['S3OutputPath']}{training_job_name}/output/model.tar.gz"
    context.log.info(f"Demand training complete: {model_artifact_s3_path}")
    return model_artifact_s3_path

@op(
    name="trigger_sagemaker_training_leadtime",
    ins={"train_s3_path": In(str)},
    out={"model_artifact_s3_path": Out(str)},
    required_resource_keys={"sagemaker"},
)
def trigger_sagemaker_training_leadtime_op(context, train_s3_path: str):
    sagemaker_client = context.resources.sagemaker
    training_job_name = f"airefill-prophet-lt-training-{context.run_id[:8]}"
    role_arn = "arn:aws:iam::200937443798:role/InfraStack-SageMakerTrainingRoleD9E95376-oB8Jp22ofRei"
    training_image_uri = "683313688378.dkr.ecr.us-east-2.amazonaws.com/sagemaker-scikit-learn:1.2-1-cpu-py3"
    s3_bucket = "ai-refill-ml-artifacts"
    
    context.log.info(f"Starting LT training: {training_job_name}")
    sagemaker_client.create_training_job(
        TrainingJobName=training_job_name,
        AlgorithmSpecification={'TrainingImage': training_image_uri, 'TrainingInputMode': 'File'},
        RoleArn=role_arn,
        InputDataConfig=[{
            'ChannelName': 'train',
            'DataSource': {'S3DataSource': {'S3DataType': 'S3Prefix', 'S3Uri': train_s3_path.rsplit('/', 1)[0] + '/', 'S3DataDistributionType': 'FullyReplicated'}},
            'ContentType': 'text/csv',
        }],
        OutputDataConfig={'S3OutputPath': f's3://{s3_bucket}/models/'},
        ResourceConfig={'InstanceType': 'ml.m5.large', 'InstanceCount': 1, 'VolumeSizeInGB': 10},
        EnableManagedSpotTraining=False,
        HyperParameters={'changepoint_prior_scale': '0.05', 'seasonality_prior_scale': '10.0'},
        StoppingCondition={'MaxRuntimeInSeconds': 3600}
    )
    
    waiter = sagemaker_client.get_waiter('training_job_completed_or_stopped')
    waiter.wait(TrainingJobName=training_job_name)
    job_desc = sagemaker_client.describe_training_job(TrainingJobName=training_job_name)
    if job_desc['TrainingJobStatus'] != 'Completed':
        raise Exception(f"LT training failed: {job_desc['FailureReason']}")
    
    model_artifact_s3_path = f"{job_desc['OutputDataConfig']['S3OutputPath']}{training_job_name}/output/model.tar.gz"
    context.log.info(f"LT training complete: {model_artifact_s3_path}")
    return model_artifact_s3_path

@op(
    name="evaluate_and_promote_model",
    ins={"demand_artifact": In(str), "demand_val": In(str), "lt_artifact": In(str), "lt_val": In(str)},
    out={"demand_promoted": Out(bool), "lt_promoted": Out(bool)},
    required_resource_keys={"sagemaker", "s3"},
)
def evaluate_and_promote_model_op(context, demand_artifact: str, demand_val: str, lt_artifact: str, lt_val: str):
    demand_promoted = _evaluate_promote_single(context, demand_artifact, demand_val, "ai-refill-demand-forecasting-group")
    lt_promoted = _evaluate_promote_single(context, lt_artifact, lt_val, "ai-refill-leadtime-forecasting-group")
    return demand_promoted, lt_promoted

@op(
    name="calculate_inventory_parameters",
    ins={"demand_promoted": In(bool), "lt_promoted": In(bool)},
    out={"new_params": Out(dict)},
    required_resource_keys={"sagemaker", "s3", "db"},
)
def calculate_inventory_parameters_op(context, demand_promoted: bool, lt_promoted: bool):
    if not (demand_promoted and lt_promoted):
        context.log.info("Skipping calc: Not both promoted.")
        return {}
    
    demand_model = _load_latest_model(context, "ai-refill-demand-forecasting-group")
    lt_model = _load_latest_model(context, "ai-refill-leadtime-forecasting-group")
    
    # Query SKUs
    sku_query = "SELECT product_id, current_inventory, unit_cost FROM skus WHERE active = true;"
    with context.resources.db.connect() as conn:
        skus_df = pd.read_sql_query(sku_query, conn)
    
    # Hist data
    demand_hist_query = """
    SELECT product_id, create_date as ds, qty_delivered as y
    FROM sales_trans WHERE create_date >= CURRENT_DATE - INTERVAL '365 days'
    ORDER BY product_id, ds;
    """
    lt_hist_query = """
    SELECT product_id, order_date as ds, (delivery_date - order_date) as y
    FROM lead_times WHERE y > 0 AND delivery_date >= CURRENT_DATE - INTERVAL '365 days'
    ORDER BY product_id, ds;
    """
    with context.resources.db.connect() as conn:
        demand_hist_df = pd.read_sql_query(demand_hist_query, conn)
        lt_hist_df = pd.read_sql_query(lt_hist_query, conn)
    
    demand_hists = {pid: group for pid, group in demand_hist_df.groupby('product_id')}
    lt_hists = {pid: group for pid, group in lt_hist_df.groupby('product_id')}
    
    if skus_df.empty:
        context.log.warning("No SKUs.")
        return {}
    
    new_params = batch_calculate_params(demand_model, lt_model, skus_df, demand_hists, lt_hists)
    context.log.info(f"Calculated params for {len(new_params)} SKUs.")
    return new_params

@op(
    name="detect_anomalies",
    ins={"demand_promoted": In(bool), "lt_promoted": In(bool)},
    out={"anomalies": Out(list)},
    required_resource_keys={"sagemaker", "s3", "db"},
)
def detect_anomalies_op(context, demand_promoted: bool, lt_promoted: bool):
    anomalies = []
    db_engine = context.resources.db
    
    # Demand anomalies
    if demand_promoted:
        demand_model = _load_latest_model(context, "ai-refill-demand-forecasting-group")
        yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        recent_query = f"""
        SELECT product_id, DATE(create_date) as ds, SUM(qty_delivered) as y
        FROM sales_trans WHERE create_date >= '{yesterday}'
        GROUP BY product_id, ds;
        """
        with db_engine.connect() as conn:
            recent_df = pd.read_sql_query(recent_query, conn)
            recent_df['ds'] = pd.to_datetime(recent_df['ds'])
        
        if not recent_df.empty:
            for _, row in recent_df.iterrows():
                future = pd.DataFrame({'ds': [row['ds']]})
                forecast = demand_model.predict(future)
                yhat = forecast['yhat'].iloc[0]
                std = (forecast['yhat_upper'].iloc[0] - forecast['yhat_lower'].iloc[0]) / (2 * 1.96)
                deviation = abs(row['y'] - yhat)
                if deviation > 2 * std:
                    anomalies.append({
                        'type': 'demand', 'product_id': row['product_id'],
                        'actual': row['y'], 'forecast': yhat, 'deviation': deviation
                    })
    
    # LT anomalies
    if lt_promoted:
        lt_model = _load_latest_model(context, "ai-refill-leadtime-forecasting-group")
        yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        lt_recent_query = f"""
        SELECT product_id, DATE(order_date) as ds, AVG((delivery_date - order_date)::float) as y
        FROM lead_times WHERE order_date >= '{yesterday}' GROUP BY product_id, ds;
        """
        with db_engine.connect() as conn:
            lt_recent = pd.read_sql_query(lt_recent_query, conn)
            lt_recent['ds'] = pd.to_datetime(lt_recent['ds'])
        
        if not lt_recent.empty:
            for _, row in lt_recent.iterrows():
                future = pd.DataFrame({'ds': [row['ds']]})
                fc = lt_model.predict(future)
                yhat = fc['yhat'].iloc[0]
                std = (fc['yhat_upper'].iloc[0] - fc['yhat_lower'].iloc[0]) / (2 * 1.96)
                deviation = abs(row['y'] - yhat)
                if deviation > 2 * std:
                    anomalies.append({
                        'type': 'lead_time', 'product_id': row['product_id'],
                        'actual': row['y'], 'forecast': yhat, 'deviation': deviation
                    })
    
    context.log.info(f"Detected {len(anomalies)} anomalies.")
    return anomalies

@op(
    name="update_db_and_alert",
    ins={"new_params": In(dict), "anomalies": In(list)},
    required_resource_keys={"db", "sns"},
)
def update_db_and_alert_op(context, new_params: dict, anomalies: list):
    if not new_params:
        context.log.info("No params to update.")
        return

    db_engine = context.resources.db
    sns_client = context.resources.sns
    topic_arn = sns_client.topic_arn

    # Bulk UPDATE
    updated_count = 0
    with db_engine.begin() as conn:
        for product_id, params in new_params.items():
            if params.get('reorder_point', 0) == 0 and params.get('safety_stock', 0) == 0:
                continue
            update_sql = """
            UPDATE skus
            SET reorder_point = :rop, safety_stock = :ss
            WHERE product_id = :pid;
            """
            conn.execute(update_sql, {'rop': params['reorder_point'], 'ss': params['safety_stock'], 'pid': product_id})
            updated_count += 1
    context.log.info(f"Updated {updated_count} SKUs.")

    # Alert
    if anomalies:
        subject = f"AI Refill Alert: {len(anomalies)} anomalies on {datetime.now().strftime('%Y-%m-%d')}"
        message = "Anomalies:\n" + "\n".join([
            f"{a['type'].upper()}: SKU {a['product_id']}: Actual {a['actual']:.1f} vs Forecast {a['forecast']:.1f} (dev {a['deviation']:.1f})"
            for a in anomalies
        ])
        sns_client.publish(TopicArn=topic_arn, Message=message, Subject=subject)
        context.log.info("SNS alert sent.")
    else:
        context.log.info("No anomalies.")

@graph(name="ml_retraining_graph")
def ml_retraining_graph():
    d_path, lt_path = extract_training_data_op()
    d_train, d_val, lt_train, lt_val = feature_engineering_op(d_path, lt_path)
    d_artifact = trigger_sagemaker_training_op(d_train)
    lt_artifact = trigger_sagemaker_training_leadtime_op(lt_train)
    d_prom, lt_prom = evaluate_and_promote_model_op(
        demand_artifact=d_artifact, demand_val=d_val,
        lt_artifact=lt_artifact, lt_val=lt_val
    )
    params = calculate_inventory_parameters_op(d_prom, lt_prom)
    anoms = detect_anomalies_op(d_prom, lt_prom)
    update_db_and_alert_op(new_params=params, anomalies=anoms)