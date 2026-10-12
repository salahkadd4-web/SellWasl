# Image du Web (phase 29, docs/ci-cd.md). Compilée depuis la racine du dépôt :
#   docker build -f apps/web/Dockerfile -t sellwasl-web .
# Les variables NEXT_PUBLIC_* et l'adresse de l'API sont figées à la compilation (une image par
# environnement) ; TRUST_PROXY, PLATFORM_ALLOWED_IPS et SENTRY_DSN sont lues au démarrage.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# --- Monorepo réduit au Web et à ses paquets
FROM base AS prune
COPY . .
RUN npx --yes turbo@2.11.7 prune @sellwasl/web --docker

# --- Compilation
FROM base AS builder
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
COPY --from=prune /app/out/full/ .
# Adresse de l'API vue du serveur Web (réseau Docker) et réglages publics de l'environnement
ARG API_URL=http://api:3001
ARG NEXT_PUBLIC_MAP_TILE_URL
ARG NEXT_PUBLIC_MAP_ATTRIBUTION
ARG NEXT_PUBLIC_SENTRY_DSN
ENV API_URL=$API_URL \
  NEXT_PUBLIC_MAP_TILE_URL=$NEXT_PUBLIC_MAP_TILE_URL \
  NEXT_PUBLIC_MAP_ATTRIBUTION=$NEXT_PUBLIC_MAP_ATTRIBUTION \
  NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
  NEXT_OUTPUT=standalone \
  NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo run build --filter=@sellwasl/web

# --- Image finale
FROM base AS runner
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3000 \
  HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/app/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
