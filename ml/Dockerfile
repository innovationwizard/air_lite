FROM python:3.11-slim

WORKDIR /app

# cmdstanpy needs g++, make, and build tools to compile Stan models
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install cmdstan 2.33.1 (exact version Prophet 1.1.6 expects)
# Do NOT set CMDSTAN env var — Prophet overrides it internally
RUN python -c "import cmdstanpy; cmdstanpy.install_cmdstan(version='2.33.1', verbose=True)"

# Verify Prophet can load the Stan backend
RUN python -c "from prophet import Prophet; m = Prophet(); print('Prophet + cmdstan OK')"

COPY . .

EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--timeout", "600", "--workers", "1", "api:app"]
