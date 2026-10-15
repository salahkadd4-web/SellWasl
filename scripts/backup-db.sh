#!/usr/bin/env bash
# Sauvegarde de la base SellWasl (phase 27, docs/security.md §6).
#
# Usage : DATABASE_URL=postgresql://… [BACKUP_DIR=backups] [RETENTION_DAYS=14] scripts/backup-db.sh
# BACKUP_SCHEMA=public : ce seul schéma (Supabase : ses schémas internes ne se restaurent pas ailleurs).
# Sans client PostgreSQL sur la machine : PG_DOCKER_CONTAINER=<conteneur> (DATABASE_URL vue depuis
# le conteneur). Affiche le chemin de l'archive créée.
set -euo pipefail
# L'archive contient toute la base : dossier et fichiers lisibles par leur seul propriétaire
umask 077

: "${DATABASE_URL:?DATABASE_URL manquante}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

run() {
  if [ -n "${PG_DOCKER_CONTAINER:-}" ]; then docker exec -i "$PG_DOCKER_CONTAINER" "$@"; else "$@"; fi
}

mkdir -p -m 700 "$BACKUP_DIR"
file="$BACKUP_DIR/sellwasl-$(date -u +%Y%m%dT%H%M%SZ).dump"

# Format personnalisé, compressé : restauration sélective possible ; écrit à part puis renommé
run pg_dump --format=custom --compress=9 --no-owner --no-privileges --dbname="$DATABASE_URL" \
  ${BACKUP_SCHEMA:+--schema="$BACKUP_SCHEMA"} > "$file.part"
mv "$file.part" "$file"

# L'archive doit se relire, sinon la sauvegarde est en échec
run pg_restore --list < "$file" > /dev/null

# Rotation : les archives plus anciennes que RETENTION_DAYS jours sont supprimées
find "$BACKUP_DIR" -name 'sellwasl-*.dump' -mtime +"$RETENTION_DAYS" -delete

echo "$file"
