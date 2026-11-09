#!/usr/bin/env bash
# Prove Azure OpenAI chat before blaming the app. Does not print the key.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a
  # Export only the keys we need without sourcing arbitrary shell from .env comments
  KEY="$(grep -E '^OPENAI_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  ENDPOINT="$(grep -E '^OPENAI_BASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  MODEL="$(grep -E '^OPENAI_MODEL=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  set +a
fi

KEY="${OPENAI_API_KEY:-${KEY:-}}"
ENDPOINT="${OPENAI_BASE_URL:-${ENDPOINT:-https://exxondemofdr.cognitiveservices.azure.com/openai/v1}}"
MODEL="${OPENAI_MODEL:-${MODEL:-gpt-5-mini}}"

if [ -z "$KEY" ]; then
  echo "OPENAI_API_KEY is empty. Put it in .env or export it, then re-run."
  exit 1
fi

echo "POST ${ENDPOINT%/}/chat/completions  model=${MODEL}"
curl -sS "${ENDPOINT%/}/chat/completions" \
  -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"${MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: PONG\"}]}"
echo
