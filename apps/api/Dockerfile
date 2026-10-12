# Image de l'API (phase 29, docs/ci-cd.md). Compilée depuis la racine du dépôt :
#   docker build -f apps/api/Dockerfile -t sellwasl-api .
# Au démarrage : migrations (prisma migrate deploy), puis l'API.

FROM node:22-bookworm-slim AS base
# OpenSSL : moteur de migration de Prisma
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# --- Monorepo réduit à l'API et à ses paquets
FROM base AS prune
COPY . .
RUN npx --yes turbo@2.11.7 prune @sellwasl/api --docker

# --- Compilation
FROM base AS builder
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
COPY --from=prune /app/out/full/ .
# prisma.config.ts exige une adresse de base, jamais contactée par `prisma generate`
RUN DATABASE_URL=postgresql://compilation:compilation@localhost:5432/compilation \
  pnpm turbo run build --filter=@sellwasl/api

# --- Dépendances de production de l'API et des paquets qu'elle charge, seules (scripts
# d'installation des dépendances compris : moteurs de Prisma), sans la compilation des paquets du
# dépôt, déjà faite
FROM base AS deps
COPY --from=prune /app/out/json/ .
RUN npm pkg delete scripts.postinstall
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile \
  --filter @sellwasl/api --filter @sellwasl/business-rules --filter @sellwasl/validation

# --- Image finale
FROM base AS runner
ENV NODE_ENV=production
ENV API_PORT=3001
ENV STORAGE_DIR=/data/storage
COPY --from=deps --chown=node:node /app/ .
COPY --from=builder --chown=node:node /app/packages/business-rules/dist packages/business-rules/dist
COPY --from=builder --chown=node:node /app/packages/validation/dist packages/validation/dist
COPY --from=builder --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=prune --chown=node:node /app/out/full/apps/api/prisma apps/api/prisma
COPY --from=prune --chown=node:node /app/out/full/apps/api/prisma.config.ts apps/api/prisma.config.ts
RUN mkdir -p /data/storage && chown node:node /data/storage
VOLUME /data/storage
USER node
WORKDIR /app/apps/api
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.API_PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["sh", "-c", "npx --no-install prisma migrate deploy && exec node dist/main.js"]
