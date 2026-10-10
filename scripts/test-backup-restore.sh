#!/usr/bin/env bash
# Test de restauration (phase 27) : sauvegarde de la base de développement, restauration dans une
# base vide, comptes de lignes identiques pour chaque table. À refaire avant le pilote, sur une
# copie des sauvegardes de l'hébergeur.
#
# Usage (docker-compose du dépôt) : scripts/test-backup-restore.sh
set -euo pipefail

export PG_DOCKER_CONTAINER="${PG_DOCKER_CONTAINER:-sellwasl-postgres-1}"
SOURCE="${SOURCE_DATABASE_URL:-postgresql://sellwasl:sellwasl@localhost:5432/sellwasl}"
ADMIN="${ADMIN_DATABASE_URL:-postgresql://sellwasl:sellwasl@localhost:5432/postgres}"
TARGET_DB="sellwasl_restore_test"
TARGET="${SOURCE%/*}/$TARGET_DB"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"; docker exec -i "$PG_DOCKER_CONTAINER" psql "$ADMIN" -qc "drop database if exists $TARGET_DB" >/dev/null' EXIT

here="$(cd "$(dirname "$0")" && pwd)"
docker exec -i "$PG_DOCKER_CONTAINER" psql "$ADMIN" -qc "drop database if exists $TARGET_DB" >/dev/null
docker exec -i "$PG_DOCKER_CONTAINER" psql "$ADMIN" -qc "create database $TARGET_DB" >/dev/null

file=$(DATABASE_URL="$SOURCE" BACKUP_DIR="$dir" "$here/backup-db.sh")
echo "Sauvegarde : $(du -h "$file" | cut -f1)"
TARGET_DATABASE_URL="$TARGET" "$here/restore-db.sh" "$file"

COUNTS="select table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', table_name), false, true, '')))[1]::text from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"
before=$(docker exec -i "$PG_DOCKER_CONTAINER" psql "$SOURCE" -tAc "$COUNTS")
after=$(docker exec -i "$PG_DOCKER_CONTAINER" psql "$TARGET" -tAc "$COUNTS")
if [ "$before" != "$after" ]; then
  echo "Comptes différents après restauration :" >&2
  diff <(echo "$before") <(echo "$after") >&2 || true
  exit 1
fi
echo "Restauration vérifiée : $(echo "$before" | wc -l) tables, comptes de lignes identiques."
