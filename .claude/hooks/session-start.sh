#!/bin/bash
# Démarrage d'une session Claude Code dans le cloud : dépendances, PostgreSQL local et base de
# développement, pour que le lint, les vérifications de types et les tests fonctionnent.
# Sur un poste de développeur, ce script ne fait rien (voir README : Docker et pnpm dev).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

DB_USER=sellwasl
DB_PASSWORD=sellwasl
DB_NAME=sellwasl
DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"

# 1. Dépendances (postinstall construit aussi les paquets partagés)
pnpm install

# 2. PostgreSQL du conteneur (le service s'arrête quand le conteneur est mis en veille)
if command -v pg_ctlcluster >/dev/null 2>&1; then
  version=$(ls /etc/postgresql | sort -n | tail -1)
  sudo pg_ctlcluster "$version" main start 2>/dev/null || true
  for _ in $(seq 1 30); do
    sudo -u postgres psql -Atc 'select 1' >/dev/null 2>&1 && break
    sleep 1
  done
  # Rôle avec CREATEDB : les tests recréent leur base <nom>_test
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}' CREATEDB;
  ELSE
    ALTER ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}' CREATEDB;
  END IF;
END
\$\$;
SQL
  if ! sudo -u postgres psql -Atc "select 1 from pg_database where datname = '${DB_NAME}'" | grep -q 1; then
    sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
  fi
fi

# 3. Fichiers d'environnement locaux (ignorés par git)
if [ ! -f apps/api/.env ]; then
  printf 'DATABASE_URL=%s\nAPI_PORT=3001\nSTORAGE_DIR=storage\n' "$DB_URL" > apps/api/.env
fi
if [ ! -f apps/web/.env ]; then
  printf 'API_URL=http://localhost:3001\n' > apps/web/.env
fi

# 4. Client Prisma, migrations et données de démonstration (seulement si la base est vide)
pnpm --filter @sellwasl/api exec prisma generate >/dev/null
pnpm --filter @sellwasl/api exec prisma migrate deploy
companies=$(sudo -u postgres psql -d "${DB_NAME}" -Atc 'select count(*) from company' 2>/dev/null || echo 0)
if [ "${companies:-0}" = "0" ]; then
  pnpm db:seed
fi
