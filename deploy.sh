#!/bin/bash
set -e

echo "=== SEAL Claude Mastery — EC2 Deploy Script ==="

# ── 1. Install dependencies if missing ───────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  sudo yum update -y
  sudo yum install -y docker git
  sudo systemctl start docker
  sudo systemctl enable docker
  sudo usermod -aG docker ec2-user
  echo "Docker installed. Please run: newgrp docker && ./deploy.sh"
  exit 0
fi

if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null 2>&1; then
  echo "Installing Docker Compose..."
  sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/bin/docker-compose
  sudo chmod +x /usr/local/bin/docker-compose
fi

# ── 2. Create .env if it doesn't exist ───────────────────────────────────────
if [ ! -f .env ]; then
  echo ""
  echo "Creating .env file..."

  # Generate random JWT secrets
  JWT_ACCESS=$(openssl rand -hex 32)
  JWT_REFRESH=$(openssl rand -hex 32)

  cat > .env <<EOF
NODE_ENV=production
APP_URL=http://52.0.130.62
API_PORT=4000
LOG_LEVEL=info

DATABASE_URL=postgresql://seal:seal@postgres:5432/seal?schema=public

REDIS_URL=redis://redis:6379

JWT_ACCESS_SECRET=${JWT_ACCESS}
JWT_REFRESH_SECRET=${JWT_REFRESH}
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# AWS Bedrock — uses EC2 IAM role (WeaveEC2BedrockRole), no keys needed
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=
BEDROCK_ENABLED=true
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0
ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0
ANTHROPIC_GENERATION_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0
ANTHROPIC_EVALUATION_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0
ANTHROPIC_CRITIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1

AI_MONTHLY_BUDGET_USD=250
AI_GENERATION_CONCURRENCY=2
AI_MAX_TOKENS=8192

COOKIE_SECURE=false
COOKIE_DOMAIN=

SEED_SUPERADMIN_EMAIL=superadmin@seal.local
SEED_SUPERADMIN_PASSWORD=SealAdmin!2026
EOF

  echo ".env created with auto-generated JWT secrets."
fi

# ── 3. Pull latest code ───────────────────────────────────────────────────────
echo ""
echo "Pulling latest code..."
git pull origin main 2>/dev/null || true

# ── 4. Build and start containers ────────────────────────────────────────────
echo ""
echo "Building and starting containers (this takes 3-5 minutes first time)..."
docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true
docker compose up -d --build 2>/dev/null || docker-compose up -d --build

# ── 5. Done ──────────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  SEAL is deploying!"
echo "  URL:      http://52.0.130.62  (or port 8080 if 80 is blocked)"
echo "  Login:    superadmin"
echo "  Password: SealAdmin!2026"
echo "============================================"
echo ""
echo "Check logs: docker compose logs -f api"
