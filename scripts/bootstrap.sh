#!/usr/bin/env bash
# One-time install of every dependency. Run from the repo root: npm run bootstrap
# Versions are resolved by npm at install time and then locked in package-lock.json.
# The orchestrator runs this once and commits package.json + package-lock.json,
# so the rest of the team only needs `npm install`.
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (20.9 or newer)." >&2
  exit 1
fi

echo "Installing runtime dependencies..."
npm install \
  next react react-dom \
  zod \
  pg drizzle-orm \
  jose \
  pdfkit \
  @paypal/react-paypal-js \
  dotenv

echo "Installing dev dependencies..."
npm install -D \
  typescript @types/node @types/react @types/react-dom @types/pg @types/pdfkit \
  drizzle-kit tsx

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Fill in your PayPal and LLM values."
fi

echo "Done. Next: npm run db:up, then npm run db:generate and npm run db:migrate (first time only)."
