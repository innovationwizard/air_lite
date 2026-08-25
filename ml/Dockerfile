FROM python:3.12-slim

WORKDIR /app

# System dependencies:
#   build-essential — CmdStan compilation (Prophet)
#   poppler-utils   — `pdftotext`, used by reyma_factura_extract to read the
#                     REYMA CFDI invoices Alexis uploads (A12). The parser is
#                     deterministic because these PDFs are machine-generated
#                     (N1: DevExpress), so no OCR stack is needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && pdftotext -v

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

# Two workers, not one (2026-08-25): `/forecast/revenue-daily` is synchronous and
# `--timeout 3600` lets it hold a worker for a long time. With a single worker,
# Alexis' invoice upload would queue behind whatever else the service is doing.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--timeout", "3600", "--workers", "2", "api:app"]
