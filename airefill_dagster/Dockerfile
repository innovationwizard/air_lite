# ─── Build stage ──────────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# Install build-time system dependencies (gcc required for some Python extensions)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY airefill/ ./airefill/

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -e .

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM python:3.11-slim AS runner

# Runtime system dependency only (libpq for psycopg2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --gid 1001 dagster \
    && useradd --uid 1001 --gid dagster --no-create-home dagster

WORKDIR /opt/dagster/app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /build/airefill ./airefill

ENV DAGSTER_HOME=/opt/dagster/dagster_home
RUN mkdir -p $DAGSTER_HOME && chown dagster:dagster $DAGSTER_HOME

USER dagster

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import airefill" || exit 1

CMD ["python", "-m", "airefill.run_pipeline"]
