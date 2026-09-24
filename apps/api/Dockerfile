# MediNova API — multi-stage build (Node 20, pnpm workspace).
# Build from the repo root:  docker build -f apps/api/Dockerfile -t medinova-api .
# Run:                        docker run -p 4000:4000 --env-file apps/api/.env medinova-api

FROM node:20-alpine AS base
RUN corepack enable && apk add --no-cache curl

# --- deps -------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @medinova/api...

# --- build ------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @medinova/shared build \
 && pnpm --filter @medinova/api build \
 && pnpm --filter @medinova/api deploy --prod /out

# --- runtime ----------------------------------------------------------------
FROM node:20-alpine AS runtime
RUN corepack enable && addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD curl -fsS http://localhost:4000/health || exit 1
CMD ["node", "dist/index.js"]
