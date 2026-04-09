# ============================================================
# apps/worker/Dockerfile — BullMQ Worker (ARCA + async tasks)
# ============================================================

FROM node:20-alpine AS deps
WORKDIR /app
RUN npm i -g pnpm@9

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json    ./packages/shared/
COPY packages/config/package.json    ./packages/config/
COPY apps/worker/package.json        ./apps/worker/

RUN pnpm install --frozen-lockfile --prod=false

FROM node:20-alpine AS builder
WORKDIR /app
RUN npm i -g pnpm@9

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages     ./packages
COPY . .

RUN pnpm --filter @erp/database generate
RUN pnpm --filter @erp/shared build
RUN pnpm --filter @erp/worker build

FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 worker \
 && apk add --no-cache openssl

COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist  ./dist
COPY --from=builder --chown=worker:nodejs /app/node_modules       ./node_modules
COPY --from=builder --chown=worker:nodejs /app/packages           ./packages

USER worker

ENV NODE_ENV=production

CMD ["node", "dist/main.js"]
