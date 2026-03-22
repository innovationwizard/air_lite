import argparse
import os
import pandas as pd
from prophet import Prophet
import joblib

def train(args):
    # SageMaker data channels
    training_data_path = os.path.join(args.train, 'train.csv')
    
    print(f"Loading training data from: {training_data_path}")
    df = pd.read_csv(training_data_path)
    
    # Prophet requires columns to be named 'ds' (datestamp) and 'y' (value)
    df.rename(columns={'create_date': 'ds', 'qty_delivered': 'y'}, inplace=True)
    
    print("Initializing and fitting Prophet model...")
    # Use hyperparameters from dagster op
    model = Prophet(
        changepoint_prior_scale=args.changepoint_prior_scale,
        seasonality_prior_scale=args.seasonality_prior_scale,
        interval_width=0.95
    )
    model.fit(df)
    
    print("Model training complete.")
    
    # SageMaker expects model artifact in this directory
    model_path = os.path.join(args.model_dir, "model.joblib")
    print(f"Saving model to: {model_path}")
    joblib.dump(model, model_path)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    
    # --- Hyperparameters ( by dagster) ---
    parser.add_argument('--changepoint_prior_scale', type=float, default=0.05)
    parser.add_argument('--seasonality_prior_scale', type=float, default=10.0)
    
    # --- SageMaker environment variables ---
    # INPUT location of training data
    parser.add_argument('--train', type=str, default=os.environ.get('SM_CHANNEL_TRAIN'))
    # OUTPUT location of trained model
    parser.add_argument('--model_dir', type=str, default=os.environ.get('SM_MODEL_DIR'))
    
    args = parser.parse_args()
    train(args)


