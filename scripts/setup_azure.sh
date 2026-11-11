#!/usr/bin/env bash
# First-boot helper for SEAL on rapid-build-dev-server (Azure VM).
# Does not print or commit API keys. Paste OPENAI_API_KEY into .env yourself.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

AZURE_IP="${AZURE_PUBLIC_IP:-20.127.186.132}"
APP_PORT="${SEAL_APP_PORT:-3000}"

echo "=== SEAL Claude Mastery — Azure setup ==="
echo "Target UI: http://${AZURE_IP}:${APP_PORT}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.asc ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
    sudo chmod a+r /etc/apt/keyrings/docker.asc
  fi
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo usermod -aG docker "${SUDO_USER:-$USER}" || true
  echo "Docker installed. Re-run this script (or open a new SSH session) so the docker group applies."
fi

if [ ! -f .env ]; then
  echo "Creating .env from .env.example (JWT secrets randomized)..."
  JWT_ACCESS="$(openssl rand -hex 32)"
  JWT_REFRESH="$(openssl rand -hex 32)"
  SEED_PASS="${SEED_SUPERADMIN_PASSWORD:-SealAdmin!2026}"
  cat > .env <<EOF
NODE_ENV=production
APP_URL=http://${AZURE_IP}:${APP_PORT}
API_PORT=4000
LOG_LEVEL=info

DATABASE_URL=postgresql://seal:seal@postgres:5432/seal?schema=public
REDIS_URL=redis://redis:6379

JWT_ACCESS_SECRET=${JWT_ACCESS}
JWT_REFRESH_SECRET=${JWT_REFRESH}
JWT_ACCESS_TTL=3h
JWT_REFRESH_TTL=7d

SEAL_CLOUD=azure
AI_PROVIDER=openai
BEDROCK_ENABLED=false

OPENAI_API_KEY=
OPENAI_BASE_URL=https://exxondemofdr.cognitiveservices.azure.com/openai/v1
OPENAI_MODEL=gpt-5-mini

ANTHROPIC_API_KEY=
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=

AI_MONTHLY_BUDGET_USD=250
AI_GENERATION_CONCURRENCY=2
AI_MAX_TOKENS=8192

COOKIE_SECURE=false
COOKIE_DOMAIN=

SEED_SUPERADMIN_EMAIL=superadmin@seal.local
SEED_SUPERADMIN_PASSWORD=${SEED_PASS}
EOF
  echo ".env created. Edit OPENAI_API_KEY before relying on AI features:"
  echo "  nano .env"
  echo "Then prove the key: bash scripts/test-llm.sh"
else
  echo ".env already exists — leaving it unchanged."
fi

COMPOSE=(docker compose)
if ! docker compose version >/dev/null 2>&1; then
  COMPOSE=(sudo docker compose)
fi

echo "Building and starting containers..."
"${COMPOSE[@]}" up -d --build

echo ""
echo "============================================"
echo "  SEAL on Azure"
echo "  URL:      http://${AZURE_IP}:${APP_PORT}"
echo "  Login:    superadmin@seal.local"
echo "  NSG:      open inbound TCP ${APP_PORT} on rapid-build-dev-server-nsg"
echo "  After .env edits: sudo docker compose up -d   (restart is not enough)"
echo "============================================"
