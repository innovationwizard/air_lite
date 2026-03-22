from dagster import (
    Definitions,
    ScheduleDefinition,
    load_assets_from_modules,
)
# --- IMPORT the official resource ---
from dagster_aws.secretsmanager import SecretsManagerSecretsResource

from airefill import assets
from airefill.pipelines import ingestion_and_reconciliation_graph
from airefill.ml_pipelines import ml_retraining_graph
from airefill.legacy_pipeline import legacy_data_etl_graph
from airefill.resources import (
    # secretsmanager_resource is no longer imported from here
    odoo_resource,
    db_resource,
    sns_resource,
    s3_resource,
    sagemaker_resource,
)

all_assets = load_assets_from_modules([assets])

# --- Pre-configure all required resources ---

# Use the official resource directly with the correct config key: "secrets"
configured_secretsmanager = SecretsManagerSecretsResource(
    secrets=[
        "airefill/dagster/db_credentials",
        "airefill/dagster/odoo_credentials",
    ]
)
configured_db_resource = db_resource.configured({"secret_name": "airefill/dagster/db_credentials"})
configured_odoo_resource = odoo_resource.configured({"secret_name": "airefill/dagster/odoo_credentials"})
configured_sns_resource = sns_resource.configured({
    "region": "us-east-2",
    "topic_arn": "arn:aws:sns:us-east-2:123456789012:airefill-alerts-placeholder"
})
configured_s3_resource = s3_resource.configured({"region": "us-east-2"})
configured_sagemaker_resource = sagemaker_resource.configured({"region": "us-east-2"})


# --- Define Jobs with pre-configured resources ---
ingestion_job = ingestion_and_reconciliation_graph.to_job(
    name="ingestion_job",
    resource_defs={
        "secretsmanager": configured_secretsmanager,
        "db": configured_db_resource,
        "odoo": configured_odoo_resource,
        "sns": configured_sns_resource,
    },
)

retraining_job = ml_retraining_graph.to_job(
    name="ml_retraining_job",
    resource_defs={
        "secretsmanager": configured_secretsmanager,
        "db": configured_db_resource,
        "s3": configured_s3_resource,
        "sagemaker": configured_sagemaker_resource,
        "sns": configured_sns_resource, 
    },
)

legacy_data_etl_job = legacy_data_etl_graph.to_job(
    name="legacy_data_etl_job",
    resource_defs={
        "secretsmanager": configured_secretsmanager,  # Add this
        "s3": configured_s3_resource,
        "db": configured_db_resource,
    },
)

# --- Define Schedules and Final Definitions ---
daily_ingestion_schedule = ScheduleDefinition(
    job=ingestion_job,
    cron_schedule="0 9 * * *",
)
weekly_retraining_schedule = ScheduleDefinition(
    job=retraining_job,
    cron_schedule="0 10 * * 0",
)
defs = Definitions(
    assets=all_assets,
    jobs=[ingestion_job, retraining_job, legacy_data_etl_job],
    schedules=[daily_ingestion_schedule, weekly_retraining_schedule],
)