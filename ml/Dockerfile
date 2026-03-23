FROM python:3.11-slim

WORKDIR /app

# cmdstanpy needs g++ and make to compile Stan models
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install cmdstan
RUN python -c "import cmdstanpy; cmdstanpy.install_cmdstan(verbose=True)"

# Prophet looks for cmdstan at prophet/stan_model/cmdstan-2.33.1
# but install_cmdstan puts it at ~/.cmdstan/cmdstan-X.Y.Z
# Symlink the installed version to where Prophet expects it
RUN CMDSTAN_INSTALLED=$(python -c "import cmdstanpy; print(cmdstanpy.cmdstan_path())") && \
    PROPHET_EXPECTED="/usr/local/lib/python3.11/site-packages/prophet/stan_model/cmdstan-2.33.1" && \
    mkdir -p "$(dirname $PROPHET_EXPECTED)" && \
    ln -sf "$CMDSTAN_INSTALLED" "$PROPHET_EXPECTED" && \
    echo "Symlinked $CMDSTAN_INSTALLED -> $PROPHET_EXPECTED"

# Verify Prophet can load the backend
RUN python -c "from prophet import Prophet; m = Prophet(); print('Prophet + cmdstan OK')"

COPY . .

EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--timeout", "600", "--workers", "1", "api:app"]
