#!/usr/bin/env bash
# Démarrage d'essai des images (phase 29, docs/ci-cd.md) : base, API et Web démarrent comme en
# production ; l'API répond à travers le Web et l'espace plateforme suit PLATFORM_ALLOWED_IPS lue
# au démarrage. Images : API_IMAGE et WEB_IMAGE (par défaut sellwasl-api:local, sellwasl-web:local).
set -euo pipefail
cd "$(dirname "$0")"

export POSTGRES_PASSWORD="essai-$(date +%s)"
export JWT_ACCESS_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export DATA_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
export PLATFORM_ALLOWED_IPS=203.0.113.9
export WEB_TRUST_PROXY=1
export WEB_PORT="${WEB_PORT:-3200}"
compose=(docker compose -f compose.yml -p sellwasl-essai)

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then "${compose[@]}" logs --tail 80 || true; fi
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

"${compose[@]}" up -d --wait --wait-timeout 240

base="http://localhost:${WEB_PORT}"
check() { # <statut attendu> <chemin> [en-tête]
  local got
  got=$(curl -s -o /dev/null -w '%{http_code}' ${3:+-H "$3"} "$base$2")
  if [ "$got" != "$1" ]; then
    echo "ÉCHEC : $2 ${3:-} → $got (attendu $1)"
    exit 1
  fi
  echo "ok : $2 ${3:-} → $got"
}

check 200 /api/v1/health
check 200 /app/login
check 404 /admin/login
check 200 /admin/login 'X-Forwarded-For: 203.0.113.9'
echo "Démarrage d'essai réussi."
