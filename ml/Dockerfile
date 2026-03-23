FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for Prophet (cmdstan needs a C++ compiler)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Prophet requires cmdstan to be installed and compiled
# This step downloads and compiles the Stan backend (~2-3 minutes)
RUN python -c "import cmdstanpy; cmdstanpy.install_cmdstan()"

COPY . .

EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--timeout", "600", "--workers", "1", "api:app"]
