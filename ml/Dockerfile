FROM python:3.11-slim

WORKDIR /app

# cmdstanpy needs g++ and make to compile Stan models
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install Python packages first (prophet 1.1.5 will pull cmdstanpy as dep)
RUN pip install --no-cache-dir -r requirements.txt

# Install cmdstan binary
RUN python -c "import cmdstanpy; cmdstanpy.install_cmdstan(verbose=True)"

# Verify Prophet works with cmdstanpy backend
RUN python -c "from prophet import Prophet; m = Prophet(); print('Prophet OK')"

COPY . .

EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--timeout", "600", "--workers", "1", "api:app"]
