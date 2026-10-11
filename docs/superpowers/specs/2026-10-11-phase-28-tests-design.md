# Phase 28 — Tests : conception

> Rédigé le 2026-10-11, validé en conversation (« Oui allons y »). Choix : Web avec Playwright et
> tests de composants ; mobile avec tests d'écrans jest-expo ; couverture mesurée avec un seuil.

## 1. Existant

- API : 318 tests d'intégration (Vitest, vraie base PostgreSQL recréée à chaque lancement) :
  droits, isolation entre entreprises, modules, stock et concurrence, commandes, synchronisation,
  sécurité.
- `packages/business-rules` : 91 tests unitaires (machine à états des commandes, fréquences,
  prix, droits par rôle…). `packages/offline` : 30 tests.
- Rien pour `packages/validation`, le Web et les écrans du mobile.

## 2. Backend : matrice des droits et des modules

- Routes relevées par `buildOpenApi` (droit exigé `x-permission`), pour chaque rôle de
  l'entreprise de prévente : admin, superviseur, comptable, pré-vendeur, livreur, magasinier ;
  et le vendeur cash van de l'entreprise cash van.
- Rôle sans le droit : `403` quelle que soit la méthode (refus de la garde, avant tout
  traitement : aucun effet sur la base).
- Rôle avec le droit, sur les `GET` : jamais `403 FORBIDDEN`.
- Entreprise cash van : route dont le module est inactif → `403 MODULE_DISABLED`.
- Tests unitaires de `packages/validation` (mot de passe, pagination, filtres, schémas sensibles).

## 3. Web

- **Composants** (Vitest, jsdom, Testing Library) : menu filtré par droits et modules,
  « Afficher plus », formulaire de connexion, changement de mot de passe, utilitaires.
- **Parcours** (Playwright, Chromium) sur l'API et le Web compilés, base `sellwasl_e2e` recréée et
  semée à chaque lancement : connexion/déconnexion, tableau de bord, clients (recherche, fiche,
  création), produits, secteurs et carte, commandes, stock (niveaux, entrée), tournées et
  livraisons, journal d'audit, super-admin avec deuxième facteur. Commande `pnpm test:e2e`, hors
  de `pnpm test`.

## 4. Mobile

jest-expo et React Native Testing Library : connexion, activation, changement de mot de passe,
accueils vendeur, livreur et magasinier, visite et commande, livraison, stock, synchronisation,
notifications. Modules natifs simulés (expo-sqlite, expo-secure-store, localisation, impression,
notifications). Dans `pnpm test`.

## 5. Couverture

Rapport par paquet (v8 pour Vitest, Jest pour le mobile) ; seuils un peu sous le niveau atteint,
dans la configuration de chaque paquet : un recul fait échouer `pnpm test`.

## 6. Livrable

`docs/testing.md` (stratégie, outils, commandes, données, ajout d'un test) ; plan_VF phase 28.
