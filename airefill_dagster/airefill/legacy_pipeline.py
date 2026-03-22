from dagster import op, graph, In, Out

@op(
    name="get_legacy_files_from_s3",
    description="Finds all raw legacy data files in the S3 intake bucket.",
    required_resource_keys={"s3"}
)
def get_legacy_files_from_s3_op(context):
    files = ["s3://your-intake-bucket/raw/legacy_data.csv"]  # Placeholder
    context.log.info(f"Found {len(files)} legacy files to process.")
    return files

@op(
    name="process_and_load_legacy_data",
    description="Applies the Kirby ETL logic to the legacy files and loads them into Aurora.",
    ins={"legacy_files": In(list)},
    required_resource_keys={"s3", "db"}
)
def process_and_load_legacy_data_op(context, legacy_files: list):
    context.log.info("Processing and loading historical data into Aurora...")
    rows_loaded = 10000  # Placeholder
    return rows_loaded

@graph(name="legacy_data_etl_graph")
def legacy_data_etl_graph():
    files = get_legacy_files_from_s3_op()
    process_and_load_legacy_data_op(files)