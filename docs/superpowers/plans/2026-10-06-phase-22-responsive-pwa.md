# Phase 22 — Web responsive et PWA : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web utilisable sur desktop, tablette et smartphone, installable comme application (PWA).

**Architecture:** Un `AppShell` responsive remplace les en-têtes des deux espaces ; PWA par les conventions Next.js 16 (`app/manifest.ts`) et un service worker écrit à la main, sans dépendance.

**Tech Stack:** Next.js 16 (App Router), Tailwind 4, sharp (script d'icônes).

**Spec:** `docs/superpowers/specs/2026-10-06-phase-22-responsive-pwa-design.md`

## Global Constraints

- Composants et couleurs du thème existants (`components/ui.tsx`, variables de `globals.css`) ; aucune nouvelle dépendance d'exécution.
- Droits et modules du menu inchangés.
- Le service worker ne met jamais en cache `/api/*` ni une requête autre que GET.
- Cibles tactiles ≥ 44 px ; zone de sécurité iOS.

## Review Focus

- Un rôle sans « Suivi » ni « Comptabilité » : la barre du bas se remplit avec les entrées suivantes autorisées, jamais une entrée interdite.
- Données hors ligne : une page de l'espace ouverte hors ligne affiche la page hors ligne, jamais des chiffres en cache.
- Nouvelle version déployée : l'ancien cache est supprimé, pas de mélange de fichiers.
- Changement de page sur smartphone : le menu « Plus » se ferme.

---

### Task 1: PWA (icônes, manifeste, métadonnées, service worker, en-têtes, page hors ligne)
### Task 2: AppShell et menu groupé de l'espace entreprise (desktop, tablette, smartphone)
### Task 3: Espace plateforme dans l'AppShell
### Task 4: Graphiques SVG et dashboard
### Task 5: Ajustements smartphone (carte plein écran, en-têtes de page, grilles)
### Task 6: Documentation, CI (build Web compris), fusion locale
