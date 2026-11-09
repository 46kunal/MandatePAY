# syntax=docker/dockerfile:1
# MandatePay app image (owner: C). Used by the `app` service in docker-compose.yml.
# All dependencies are kept (not pruned) because the container runs `drizzle-kit migrate` and `tsx` at start.

FROM node:22-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are baked into the browser bundle at build time, so they are a build argument.
ARG NEXT_PUBLIC_PAYPAL_CLIENT_ID=""
ENV NEXT_PUBLIC_PAYPAL_CLIENT_ID=$NEXT_PUBLIC_PAYPAL_CLIENT_ID
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app ./
# Windows checkouts may have CRLF line endings, which break `#!/bin/sh` scripts on Linux.
RUN sed -i 's/\r$//' scripts/docker-entrypoint.sh \
 && chmod +x scripts/docker-entrypoint.sh \
 && mkdir -p .keys \
 && chown -R node:node .keys .next
USER node
EXPOSE 3000
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
