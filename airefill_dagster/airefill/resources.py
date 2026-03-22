from dagster import resource, InitResourceContext
from dagster_aws.secretsmanager import SecretsManagerSecretsResource
import json
from xmlrpc.client import ServerProxy
import sqlalchemy as sa
from sqlalchemy.engine import URL
import boto3

@resource(config_schema={"secret_arns": list})
def secretsmanager_resource(context: InitResourceContext):
    return SecretsManagerSecretsResource(secret_arns_or_names=context.resource_config["secret_arns"])

@resource(
    config_schema={"secret_name": str},
    required_resource_keys={"secretsmanager"}, # <-- ADD THIS LINE
)
def odoo_resource(context: InitResourceContext):
    secrets = context.resources.secretsmanager
    secret_value = secrets.fetch_secrets()[context.resource_config["secret_name"]]
    creds = json.loads(secret_value)
    
    class OdooConn:
        def __init__(self, creds):
            self.creds = creds
            self.uid = None
            self.models = None
        
        def _authenticate(self):
            if self.uid is None:
                common = ServerProxy(f'{self.creds["url"]}/xmlrpc/2/common')
                self.uid = common.authenticate(self.creds["db"], self.creds["username"], self.creds["password"], {})
                self.models = ServerProxy(f'{self.creds["url"]}/xmlrpc/2/object')
        
        def execute(self, model, method, *args):
            self._authenticate()
            return self.models.execute_kw(self.creds["db"], self.uid, self.creds["password"], model, method, args)
    
    return OdooConn(creds)

@resource(
    config_schema={"secret_name": str},
    required_resource_keys={"secretsmanager"},
)
def db_resource(context: InitResourceContext):
    if context.resource_config.get("mock", False):  # Enable in Dagit config
        class MockEngine:
            def connect(self):
                class MockConn:
                    description = [('product_id',), ('create_date',), ('qty_delivered',)]  # Add this
                    def __enter__(self):
                        return self
                    def __exit__(self, exc_type, exc_val, exc_tb):
                        pass
                    def execute(self, query, params=None):
                        class MockResult:
                            def fetchall(self):
                                return [(1, '2025-10-08', 3.0)]  # Tuples match SELECT cols
                            def scalar(self):
                                from datetime import datetime, timedelta
                                return datetime.now() - timedelta(days=1)
                        return MockResult()
                    def commit(self):
                        pass
                    def cursor(self):
                        return self 
                    def fetchall(self):
                       return [(1, '2025-10-08', 3.0)]
                    def close(self):
                        pass
                return MockConn()
        return MockEngine()
        
def execute(self, query, params=None):
    if "lead_times" in query:
        return MockResult(fetchall=[(1, '2025-10-01', 7.0), (1, '2025-10-02', 8.0)])  # Sample LT

@resource(config_schema={"region": str, "topic_arn": str})
def sns_resource(context: InitResourceContext):
    client = boto3.client('sns', region_name=context.resource_config.get("region", "us-east-2"))
    client.topic_arn = context.resource_config["topic_arn"]
    return client

@resource(config_schema={"region": str})
def s3_resource(context: InitResourceContext):
    """A Dagster resource for interacting with Amazon S3."""
    region = context.resource_config.get("region", "us-east-2")
    s3_client = boto3.client("s3", region_name=region)
    return s3_client

@resource(config_schema={"region": str})
def sagemaker_resource(context: InitResourceContext):
    """A Dagster resource for interacting with Amazon SageMaker."""
    region = context.resource_config.get("region", "us-east-2")
    sagemaker_client = boto3.client("sagemaker", region_name=region)
    return sagemaker_client