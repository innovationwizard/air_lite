# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /opt/dagster/app

# Copy only the files needed to install dependencies.
# This leverages Docker's layer caching. The install step will only re-run
# if these files change.
COPY setup.py setup.cfg pyproject.toml ./

# Install the project and its dependencies (including dagster) from setup.py
RUN pip install --no-cache-dir .

# Install dagster-webserver
RUN pip install --no-cache-dir dagster-webserver

# --- ADD THIS LINE ---
RUN pip install --no-cache-dir dagster-postgres
# --- END OF ADDED LINE ---

# --- ADD THESE LINES ---
# Create a directory for Dagster instance configuration and set the ENV var
ENV DAGSTER_HOME=/opt/dagster/dagster_home/
RUN mkdir -p $DAGSTER_HOME

# Copy the dagster instance configuration file into that directory
COPY air_scaffold/dagster.yaml $DAGSTER_HOME/dagster.yaml
# --- END OF ADDED LINES --- 
    
# Now copy the actual source code. Changes to your code will only invalidate this layer.
COPY air_scaffold ./air_scaffold

# Expose the port Dagster's webserver runs on
EXPOSE 3000

# Command to run the Dagster webserver.
# Note: We now point to the 'definitions' object inside your 'air_scaffold' module.
CMD ["python", "-m", "dagster_webserver", "-h", "0.0.0.0", "-p", "3000", "-m", "air_scaffold.definitions"]