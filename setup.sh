#!/usr/bin/env bash
# =============================================================================
# AI Refill – Turn-Key Bootstrap Script
# =============================================================================
# Installs all dependencies and validates the environment for the entire stack.
# Run once on a fresh machine:
#
#   chmod +x setup.sh && ./setup.sh
#
# After this script completes, follow the "Next Steps" printed at the end.
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✔ $*${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail() { echo -e "${RED}  ✖ $*${NC}"; exit 1; }
info() { echo -e "${CYAN}  → $*${NC}"; }

echo ""
echo "============================================================"
echo "  AI Refill – Bootstrap Setup"
echo "============================================================"
echo ""

# ── 1. Prerequisite checks ────────────────────────────────────────────────────
info "Checking prerequisites..."

# Node.js >= 20
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node.js 20+ from https://nodejs.org"
fi
NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js $NODE_VER detected; version 20+ is required."
fi
ok "Node.js $NODE_VER"

# Python >= 3.9
if ! command -v python3 &>/dev/null; then
  fail "Python 3.9+ not found."
fi
PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
ok "Python $PY_VER"

# Docker (optional – needed for production builds)
if command -v docker &>/dev/null; then
  ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
else
  warn "Docker not found – required for production container builds only."
fi

# AWS CLI (optional – needed for CDK / ECR pushes)
if command -v aws &>/dev/null; then
  ok "AWS CLI $(aws --version 2>&1 | awk '{print $1}')"
else
  warn "AWS CLI not found – required for cloud deployment only."
fi

echo ""

# ── 2. Environment files ──────────────────────────────────────────────────────
info "Setting up environment files..."

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# API
if [ ! -f "$ROOT_DIR/api-node/.env" ]; then
  if [ -f "$ROOT_DIR/api-node/.env.example" ]; then
    cp "$ROOT_DIR/api-node/.env.example" "$ROOT_DIR/api-node/.env"
    warn "api-node/.env created from .env.example – fill in your DB credentials."
  else
    warn "api-node/.env.example not found. Create api-node/.env manually."
  fi
else
  ok "api-node/.env already exists."
fi

# Frontend
if [ ! -f "$ROOT_DIR/frontend/.env.local" ]; then
  if [ -f "$ROOT_DIR/frontend/.env.example" ]; then
    cp "$ROOT_DIR/frontend/.env.example" "$ROOT_DIR/frontend/.env.local"
    warn "frontend/.env.local created from .env.example – set NEXT_PUBLIC_API_URL."
  else
    cat > "$ROOT_DIR/frontend/.env.local" <<'EOF'
# AI Refill – Frontend environment
# Set this to your API base URL (local or deployed)
NEXT_PUBLIC_API_URL=http://localhost:8080
EOF
    warn "frontend/.env.local created with defaults – update NEXT_PUBLIC_API_URL."
  fi
else
  ok "frontend/.env.local already exists."
fi

# Dagster
if [ ! -f "$ROOT_DIR/airefill_dagster/.env" ]; then
  cat > "$ROOT_DIR/airefill_dagster/.env" <<'EOF'
# AI Refill – Dagster environment
DAGSTER_HOME=/tmp/dagster_home
DATABASE_URL=postgresql://user:password@localhost:5432/airefill
AWS_DEFAULT_REGION=us-east-2
# ODOO credentials are stored in AWS Secrets Manager: airefill/dagster/odoo_credentials
EOF
  warn "airefill_dagster/.env created with defaults – update DATABASE_URL."
else
  ok "airefill_dagster/.env already exists."
fi

echo ""

# ── 3. Node.js dependencies ───────────────────────────────────────────────────
info "Installing Node.js dependencies..."

# API
info "  api-node..."
(cd "$ROOT_DIR/api-node" && npm install --silent)
ok "api-node dependencies installed."

# Frontend
info "  frontend..."
(cd "$ROOT_DIR/frontend" && npm install --silent)
ok "frontend dependencies installed."

# CDK (infra)
if [ -f "$ROOT_DIR/package.json" ]; then
  info "  infra_cdk (root)..."
  (cd "$ROOT_DIR" && npm install --silent)
  ok "CDK dependencies installed."
fi

echo ""

# ── 4. Python / Dagster dependencies ─────────────────────────────────────────
info "Installing Python dependencies (Dagster pipeline)..."

VENV_DIR="$ROOT_DIR/airefill_dagster/.venv"

if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
  ok "Virtual environment created at airefill_dagster/.venv"
else
  ok "Virtual environment already exists."
fi

source "$VENV_DIR/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet -e "$ROOT_DIR/airefill_dagster"
ok "Dagster dependencies installed."
deactivate

echo ""

# ── 5. Prisma / Database ──────────────────────────────────────────────────────
info "Generating Prisma client (api-node)..."
(cd "$ROOT_DIR/api-node" && npx prisma generate --silent 2>/dev/null || true)
ok "Prisma client generated."

echo ""
echo "============================================================"
echo "  Setup complete."
echo "============================================================"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit api-node/.env          → add DATABASE_URL, JWT_SECRET, etc."
echo "  2. Edit frontend/.env.local    → set NEXT_PUBLIC_API_URL"
echo "  3. Edit airefill_dagster/.env  → set DATABASE_URL + AWS region"
echo ""
echo "  4. Run database migrations:"
echo "       cd api-node && npx prisma migrate deploy"
echo ""
echo "  5. Start local development:"
echo "       # Terminal A – API"
echo "       cd api-node && npm run dev"
echo ""
echo "       # Terminal B – Frontend"
echo "       cd frontend && npm run dev"
echo ""
echo "       # Terminal C – Dagster UI"
echo "       cd airefill_dagster && source .venv/bin/activate && dagster dev"
echo ""
echo "  6. For production (Docker + CDK):"
echo "       docker build -t airefill-api:latest api-node/"
echo "       docker build -t airefill-frontend:latest frontend/"
echo "       docker build -t airefill-dagster:latest airefill_dagster/"
echo "       cd infra_cdk && npx cdk deploy --all"
echo ""
echo "  See README.md for full architecture and deployment guide."
echo ""
