# ============================================================
# apps/api/Dockerfile — Multi-stage production build
# ============================================================

# --- Stage 1: deps -------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
RUN npm i -g pnpm@9

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json    ./packages/shared/
COPY packages/config/package.json    ./packages/config/
COPY apps/api/package.json           ./apps/api/

RUN pnpm install --frozen-lockfile --prod=false

# --- Stage 2: builder ----------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
RUN npm i -g pnpm@9

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages     ./packages
COPY . .
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules

# Generar cliente Prisma
RUN pnpm --filter @erp/database generate

# Compilar shared
RUN pnpm --filter @erp/shared build

# Compilar API
RUN pnpm --filter @erp/api build

# --- Stage 3: runner -----------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nestjs \
 && apk add --no-cache wget

# Solo deps de producción
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist         ./dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/database/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/node_modules           ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/packages               ./packages

USER nestjs

EXPOSE 3000

ENV NODE_ENV=production

# Correr migraciones y luego arrancar
CMD ["sh", "-c", "node -e \"require('./node_modules/.bin/prisma') migrate deploy\" 2>/dev/null; node dist/main.js"]
