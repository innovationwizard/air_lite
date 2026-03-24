FROM python:3.11-slim

WORKDIR /app

# System dependencies for CmdStan compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Explicitly install and compile CmdStan (the missing piece in Docker)
RUN python -c '\
import cmdstanpy; \
print("Downloading and compiling CmdStan..."); \
cmdstanpy.install_cmdstan(cores=2, overwrite=True); \
print("CmdStan installed at:", cmdstanpy.cmdstan_path()); \
'

# Verify Prophet works
RUN python -c "from prophet import Prophet; m = Prophet(); print('Prophet + cmdstan OK')"

COPY . .

EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--timeout", "3600", "--workers", "1", "api:app"]
