# Scripts

Standalone entry point scripts for external execution (SageMaker, CLI tools, etc.).

These are **not** part of the importable `airefill` package.

## `train.py`

**Purpose**: SageMaker training job entry point for Prophet forecasting models.

**Usage**: Executed by SageMaker training jobs triggered from `airefill.ml_pipelines`.

**Environment Variables** (set by SageMaker):
- `SM_CHANNEL_TRAIN` - Path to training data
- `SM_MODEL_DIR` - Path where trained model should be saved

**Hyperparameters** (passed from Dagster):
- `changepoint_prior_scale` - Prophet changepoint sensitivity
- `seasonality_prior_scale` - Prophet seasonality strength

**Referenced in**: `airefill_dagster/airefill/ml_pipelines.py`
- `trigger_sagemaker_training_op()` - Demand forecasting
- `trigger_sagemaker_training_leadtime_op()` - Lead time forecasting

**Not meant to be imported** - executes as standalone script in SageMaker containers.

