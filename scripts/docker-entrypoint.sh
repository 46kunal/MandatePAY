#!/bin/sh
# Container start (owner: C): apply migrations, optionally load the demo data, then start Next.js.
# SEED_ON_START=true replaces ALL rows with the demo scenarios, so a restart resets the demo.
set -eu

echo "[mandatepay] applying database migrations..."
./node_modules/.bin/drizzle-kit migrate

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[mandatepay] loading demo data..."
  ./node_modules/.bin/tsx scripts/seed.ts
fi

echo "[mandatepay] starting on port ${PORT:-3000}"
exec ./node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
