FROM python:3.11-slim

WORKDIR /app

# Prophet 1.1.5 + pystan 2.19 need a C++ compiler for Stan model compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

# Single worker — Prophet is CPU-intensive, 2GB RAM limit on Railway
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--timeout", "600", "--workers", "1", "api:app"]
