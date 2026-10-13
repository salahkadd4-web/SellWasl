#!/usr/bin/env bash
# Réglages GitHub de la CI/CD (phase 29, docs/ci-cd.md), à lancer une fois par le propriétaire du
# dépôt, après avoir poussé main et develop :
#   gh auth login        # une seule fois
#   bash scripts/github-setup.sh
# - environnements staging (branche develop) et production (branche main) ;
# - main et develop protégées : pull request obligatoire, jobs de la CI verts, pas de poussée
#   forcée ni de suppression ; aucune relecture exigée (développeur seul).
set -euo pipefail

repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
echo "Dépôt : $repo"

for env_branch in staging:develop production:main; do
  env="${env_branch%%:*}"
  branch="${env_branch##*:}"
  gh api -X PUT "repos/$repo/environments/$env" \
    -F 'deployment_branch_policy[protected_branches]=false' \
    -F 'deployment_branch_policy[custom_branch_policies]=true' >/dev/null
  gh api -X POST "repos/$repo/environments/$env/deployment-branch-policies" \
    -f name="$branch" -f type=branch >/dev/null 2>&1 || true
  echo "Environnement $env : branche $branch seulement"
done

for branch in main develop; do
  gh api -X PUT "repos/$repo/branches/$branch/protection" --input - >/dev/null <<JSON
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Qualité (format, lint, types)",
      "Tests",
      "Compilation",
      "Parcours de bout en bout",
      "Images Docker"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false
}
JSON
  echo "Branche $branch protégée"
done
echo "Terminé. Réglages du Web (facultatifs) : Settings → Environments → staging / production →"
echo "secret NEXT_PUBLIC_MAPTILER_KEY, variable NEXT_PUBLIC_SENTRY_DSN (docs/maptiler.md)."
