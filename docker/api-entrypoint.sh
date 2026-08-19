#!/bin/sh
set -e

cd /app/server

echo "Applying database migrations…"
npx prisma migrate deploy

if [ "${SEED_ON_START:-true}" = "true" ]; then
  echo "Seeding (skipped if already initialized)…"
  node dist/seed/index.js
fi

echo "Starting SEAL API…"
exec node dist/index.js
