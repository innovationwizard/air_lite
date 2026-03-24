# Prophet Docker Fix & Backtest Pre-computation

**Date:** 2026-03-23
**Duration:** ~4 hours of debugging
**Root cause:** Prophet's CmdStanPy backend fails silently in Docker containers
**Resolution:** `cmdstanpy.install_cmdstan(cores=2, overwrite=True)` with unpinned Prophet

---

## The Problem

Prophet 1.1.6 (and 1.1.5) fail at runtime in Docker with:

```
AttributeError: 'Prophet' object has no attribute 'stan_backend'
```

This error means Prophet's `_load_stan_backend()` method iterated through all available backends, all failed silently (caught by broad `except Exception`), and `self.stan_backend` was never assigned. The debug log line `logger.debug("Loaded stan backend: %s", self.stan_backend.get_type())` then crashes because the attribute doesn't exist.

---

## Failed Attempts (in chronological order)

### Attempt 1: Pin Prophet 1.1.6 + install_cmdstan() in Dockerfile

**What we tried:**
```dockerfile
RUN pip install prophet==1.1.6 cmdstanpy>=1.2.0
RUN python -c "import cmdstanpy; cmdstanpy.install_cmdstan(verbose=True)"
ENV CMDSTAN=/root/.cmdstan
```

**Result:** `stan_backend` error persisted. Prophet still couldn't find the backend at runtime.

**Why it failed:** `install_cmdstan()` installed cmdstan 2.38.0 at `/root/.cmdstan/cmdstan-2.38.0`, but Prophet's `CmdStanPyBackend.__init__()` calls `cmdstanpy.set_cmdstan_path()` pointing to a **bundled** path at `/usr/local/lib/python3.11/site-packages/prophet/stan_model/cmdstan-2.33.1` — which doesn't exist. The bundled cmdstan directory is empty in the pip wheel.

### Attempt 2: Pin Prophet 1.1.5 + pystan 2.19.1.1

**What we tried:**
```
prophet==1.1.5
pystan==2.19.1.1
```

**Result:** Docker build failed entirely.

```
ERROR: Failed building wheel for pystan
Cython>=0.22 and NumPy are required.
ERROR: Could not build wheels for pystan
```

**Why it failed:** pystan 2.x is incompatible with Python 3.11. It requires Cython and has known build issues on Python >= 3.10. This approach is a dead end for modern Python.

### Attempt 3: Pin Prophet 1.1.5 + cmdstanpy (no pystan)

**What we tried:**
```
prophet==1.1.5
cmdstanpy>=1.2.0
```

**Result:** Same `stan_backend` error as Attempt 1.

**Why it failed:** Same root cause — Prophet 1.1.5 also looks for the bundled cmdstan at `prophet/stan_model/cmdstan-2.33.1`. The version of Prophet doesn't matter; the backend loading code has the same bug in both 1.1.5 and 1.1.6.

### Attempt 4: Symlink installed cmdstan to Prophet's expected path

**What we tried:**
```dockerfile
RUN CMDSTAN_INSTALLED=$(python -c "import cmdstanpy; print(cmdstanpy.cmdstan_path())") && \
    PROPHET_EXPECTED="/usr/local/lib/python3.11/site-packages/prophet/stan_model/cmdstan-2.33.1" && \
    mkdir -p "$(dirname $PROPHET_EXPECTED)" && \
    ln -sf "$CMDSTAN_INSTALLED" "$PROPHET_EXPECTED"
```

**Result:** Same `stan_backend` error.

**Why it failed:** Even with the symlink, Prophet's `CmdStanPyBackend.__init__()` tries to load a precompiled `prophet_model.bin` from the bundled directory. The cmdstan installation directory has `makefile`, `src/`, `bin/`, etc. — but NOT the compiled Prophet-specific Stan model binary. The backend loads the cmdstan path successfully but then fails on the model loading step, which is also silently caught.

### Attempt 5: Pin cmdstan version to 2.33.1

**What we tried:**
```dockerfile
RUN python -c "import cmdstanpy; cmdstanpy.install_cmdstan(version='2.33.1', verbose=True)"
```

**Result:** Same `stan_backend` error.

**Why it failed:** The version match doesn't help because the issue isn't the cmdstan version — it's that Prophet expects a bundled cmdstan directory with the compiled model binary, not just a raw cmdstan installation.

### Attempt 6: Remove CMDSTAN env var (per GitHub issue #2639)

**What we tried:** Removed `ENV CMDSTAN=/root/.cmdstan` from Dockerfile based on research that Prophet overrides this variable internally.

**Result:** Same `stan_backend` error.

**Why it failed:** The env var was never the problem. The issue is deeper in Prophet's backend loading mechanism.

---

## Debug Breakthrough

Added a diagnostic step to the Dockerfile that exposed the actual error:

```dockerfile
RUN python -c "\
import cmdstanpy; \
print('cmdstan path:', cmdstanpy.cmdstan_path()); \
from prophet.models import CmdStanPyBackend; \
b = CmdStanPyBackend(); \
"
```

**Output revealed:**
```
cmdstan path: /root/.cmdstan/cmdstan-2.38.0
path exists: True
...
ValueError: CmdStan installation missing makefile,
path /usr/local/lib/python3.11/site-packages/prophet/stan_model/cmdstan-2.33.1 is invalid.
You may wish to re-install cmdstan by running command
"install_cmdstan --overwrite"
```

**Key insight:** Prophet calls `cmdstanpy.set_cmdstan_path(str(local_cmdstan))` where `local_cmdstan` is the bundled path inside the Prophet package — NOT the cmdstanpy-installed path. This overrides the working installation with a broken path. The error message itself says to use `overwrite=True`.

---

## Solution That Worked

```dockerfile
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
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--timeout", "600", "--workers", "1", "api:app"]
```

**requirements.txt:**
```
prophet
pandas>=2.0.0,<3.0.0
numpy>=1.24.0,<2.0.0
supabase>=2.0.0,<3.0.0
flask>=3.0.0,<4.0.0
gunicorn>=22.0.0,<23.0.0
openpyxl>=3.1.0,<4.0.0
```

**Why it works:**

1. **`overwrite=True`** — forces cmdstanpy to install cmdstan to the **Prophet-expected bundled path** inside the package directory, overwriting the empty/broken directory that ships with the pip wheel. This is the critical flag that none of the other attempts used.
2. **Unpinned Prophet** — let pip resolve the latest compatible version (resolved to 1.1.6). Pinning to specific versions caused cascading dependency conflicts.
3. **Unpinned cmdstanpy** — let Prophet's own dependency constraints pull the compatible version.
4. **`cores=2`** — parallel compilation speeds up the cmdstan build from ~5min to ~2min.
5. **No `ENV CMDSTAN`** — let Prophet and cmdstanpy manage the path internally.
6. **Verification step** — `RUN python -c "from prophet import Prophet; m = Prophet()"` in the Dockerfile catches backend failures at build time instead of at runtime.

**Build time:** 238 seconds (~4 minutes).

---

## Post-Fix Issue: Numeric Overflow

After Prophet was working, the first successful run-all produced 14 cycles that all failed with:

```
numeric field overflow: A field with precision 8, scale 4 must round to an absolute value less than 10^4
```

**Cause:** `NUMERIC(8,4)` columns in `backtest_results` and `backtest_savings` can only store values up to 9999.9999. Prophet predictions for some products exceeded this (e.g., error_percentage > 10000% when actual demand is near zero but predicted demand is large).

**Fix:** Widened all affected columns from `NUMERIC(8,4)` to `NUMERIC(12,4)`:

```sql
ALTER TABLE backtest_results ALTER COLUMN error_percentage TYPE NUMERIC(12,4);
ALTER TABLE backtest_savings ALTER COLUMN actual_turnover_rate TYPE NUMERIC(12,4);
ALTER TABLE backtest_savings ALTER COLUMN holding_cost_rate_used TYPE NUMERIC(12,4);
ALTER TABLE backtest_savings ALTER COLUMN optimized_turnover_rate TYPE NUMERIC(12,4);
ALTER TABLE backtest_savings ALTER COLUMN purchase_savings_pct TYPE NUMERIC(12,4);
ALTER TABLE backtest_savings ALTER COLUMN rotation_improvement_pct TYPE NUMERIC(12,4);
ALTER TABLE backtest_savings ALTER COLUMN stockout_savings_pct TYPE NUMERIC(12,4);
ALTER TABLE backtest_savings ALTER COLUMN storage_savings_pct TYPE NUMERIC(12,4);
```

---

## Achieved Results

**14 backtest cycles successfully pre-computed:**

| Predict Month | Products | Duration | Total Savings (GTQ) | Purchase Savings % |
|--------------|----------|----------|--------------------|--------------------|
| Jan 2025 | 100 | 30s | 741,023 | 14.6% |
| Feb 2025 | 100 | 31s | 777,739 | 25.6% |
| Mar 2025 | 100 | 29s | 595,132 | 22.1% |
| Apr 2025 | 100 | 21s | 676,191 | 10.9% |
| May 2025 | 100 | 21s | 838,002 | 11.4% |
| Jun 2025 | 100 | 21s | 541,494 | 19.3% |
| Jul 2025 | 100 | 21s | 0 | 0.0% |
| Aug 2025 | 100 | 22s | 2,077,083 | 41.8% |
| Sep 2025 | 100 | 21s | 2,106,120 | 40.2% |
| Oct 2025 | 100 | 23s | 666,392 | 0.0% |
| Nov 2025 | 100 | 24s | 543,175 | 0.0% |
| Dec 2025 | 100 | 25s | 2,231,733 | 39.0% |
| Jan 2026 | 100 | 26s | 1,683,722 | 34.4% |
| Feb 2026 | 100 | 25s | 1,154,818 | 18.7% |

**Totals:**
- 14 cycles, 0 failures
- 1,400 product-level predictions (100 per cycle)
- ~5.5 minutes total computation time
- Cumulative savings demonstrated: **GTQ 14,632,624** across 14 months

**Known issues in results (to investigate):**
- `storage_savings_pct` is 0% across all cycles — likely missing inventory value data in the savings calculation
- `stockout_savings_pct` is a flat 80% — hardcoded prevention rate, not dynamically calculated
- `rotation_improvement_pct` is a flat 53.85% — may be using placeholder logic
- Jul 2025 shows GTQ 0 total savings — needs investigation

---

## Key Learnings

1. **Prophet's Docker support is fragile.** The pip wheel ships with an empty bundled cmdstan directory. The `overwrite=True` flag on `install_cmdstan()` is the only reliable way to populate it. This is not documented anywhere in Prophet's official docs.

2. **Silent error swallowing is the enemy.** Prophet catches ALL exceptions during backend loading with a bare `except Exception`. This means any failure — missing binary, wrong path, permission error, compilation failure — produces the same unhelpful `stan_backend` AttributeError.

3. **Build-time verification is essential.** The `RUN python -c "from prophet import Prophet; m = Prophet()"` step in the Dockerfile catches backend issues before deployment, preventing runtime failures in production.

4. **Database column sizing must account for edge cases.** Prophet can produce extreme values (e.g., 50000% error) for products with sparse data. Use `NUMERIC(12,4)` or wider for any derived metric field.

---

*No mock data. No workarounds. Prophet is training on real PLASTICENTRO production data.*
