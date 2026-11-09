#!/bin/sh
# Container start: apply migrations, then start Next.js.
set -eu

echo "[mandatepay] applying database migrations..."
./node_modules/.bin/drizzle-kit migrate

echo "[mandatepay] starting on port ${PORT:-3000}"
exec ./node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
