#!/usr/bin/env bash
# Restauration d'une sauvegarde dans une base vide (phase 27, docs/security.md §6).
#
# Usage : TARGET_DATABASE_URL=postgresql://… scripts/restore-db.sh <archive.dump>
# La base cible doit exister et être vide : on ne restaure jamais par-dessus la production.
# Sans client PostgreSQL : PG_DOCKER_CONTAINER=<conteneur>.
set -euo pipefail

file="${1:?Usage : restore-db.sh <archive.dump>}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL manquante}"

run() {
  if [ -n "${PG_DOCKER_CONTAINER:-}" ]; then docker exec -i "$PG_DOCKER_CONTAINER" "$@"; else "$@"; fi
}

tables=$(run psql "$TARGET_DATABASE_URL" -tAc \
  "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "$tables" != "0" ]; then
  echo "La base cible n'est pas vide ($tables tables) : restauration refusée." >&2
  exit 1
fi

# Archive d'un seul schéma (BACKUP_SCHEMA=public, Supabase) : elle recrée « public », qui existe
# déjà dans toute base neuve. La cible étant vide (vérifié ci-dessus), son « public » est retiré.
# Table des matières lue en entier : « grep -q » couperait le tuyau (échec avec pipefail)
toc=$(run pg_restore --list < "$file")
if grep -q ' SCHEMA - public ' <<< "$toc"; then
  run psql "$TARGET_DATABASE_URL" -qc 'drop schema public cascade' > /dev/null
fi

run pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET_DATABASE_URL" < "$file"
echo "Restauration terminée depuis $file"
