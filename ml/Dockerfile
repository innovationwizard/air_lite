FROM python:3.11-slim

WORKDIR /app

# Prophet 1.1.6 + cmdstanpy need a C++ compiler for Stan model compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install cmdstan binary (required by Prophet 1.1.6 for model fitting)
# This compiles the Stan C++ backend — takes ~2-3 minutes
ENV CMDSTAN=/root/.cmdstan
RUN python -c "import cmdstanpy; cmdstanpy.install_cmdstan(verbose=True)"

# Verify cmdstan is installed and Prophet can find it
RUN python -c "from prophet import Prophet; m = Prophet(); print('Prophet + cmdstan OK')"

COPY . .

EXPOSE 5000

# Single worker — Prophet is CPU-intensive, 2GB RAM limit on Railway
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--timeout", "600", "--workers", "1", "api:app"]
