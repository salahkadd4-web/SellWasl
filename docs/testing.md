# Tests — SellWasl

> **Phase 28 — rédigé le 2026-10-11.** Stratégie de test, outils, commandes et données. Sécurité : [security.md](security.md). Synchronisation : [offline-sync.md](offline-sync.md).

## 1. Stratégie

| Niveau | Où | Outil | Ce qui est vérifié |
|---|---|---|---|
| Règles métier | `packages/business-rules` | Vitest | Prix, paliers, bonus, quotas, fréquences, machine à états des commandes, droits par rôle, liste d'IP — avec les exemples chiffrés de business-rules.md §22 |
| Schémas | `packages/validation` | Vitest | Règles de saisie partagées (mots de passe, pagination, filtres, fiches) |
| Hors connexion | `packages/offline` | Vitest | Moteur de synchronisation (file d'envoi, reprises, rejeu), vues locales, effets des actions |
| API | `apps/api/test` | Vitest + vraie base PostgreSQL | Chaque route : droits, isolation entre entreprises, modules, stock et concurrence, commandes, synchronisation, paie, audit, sécurité, contrat (erreurs, pagination, idempotence, version) |
| Droits | `apps/api/test/rbac-matrix.test.ts` | Vitest | Matrice générée : chaque route protégée × 8 profils (refus sans le droit, `MODULE_DISABLED`, lectures autorisées) |
| Composants Web | `apps/web/src/**/*.test.tsx` | Vitest + jsdom + Testing Library | Menu filtré, « Afficher plus », formulaires, utilitaires |
| Parcours Web | `apps/web/e2e` | Playwright (Chromium) | 14 parcours dans un vrai navigateur, sur l'API et le Web compilés |
| Écrans mobiles | `apps/mobile/__tests__` | jest-expo + React Native Testing Library | Connexion, association, journée, visite et commande, livraison, stock, synchronisation, notifications |

Principes :

- **Vraie base pour l'API** : pas de simulation de Prisma ; la base de test est recréée et semée à chaque lancement.
- **Une règle, un test qui échoue sans elle** : les ajouts de la phase 28 ont été vérifiés par mutation (la règle retirée, le test échoue).
- **Pas de réseau extérieur** : les parcours Playwright coupent tout appel hors de la machine (tuiles de carte) ; les écrans mobiles échouent sur un appel réseau non simulé.
- **Tests indépendants de l'ordre** : une suite qui modifie les données de démonstration les rétablit (planning des secteurs, chargements, journées).

## 2. Commandes

| Commande | Effet | Prérequis |
|---|---|---|
| `pnpm test` | Tous les tests sauf les parcours, avec couverture et seuils | Docker (`pnpm db:up`) |
| `pnpm test:e2e` | Parcours Playwright (compile l'API, puis le Web dans `.next-e2e`) | Docker ; Chromium (`pnpm --filter @sellwasl/web exec playwright install chromium`, une fois) |
| `pnpm --filter @sellwasl/api test` | API seule (≈ 5 min) | Docker |
| `pnpm --filter @sellwasl/web test` | Composants Web | — |
| `pnpm --filter @sellwasl/mobile test` | Écrans mobiles | — |
| `pnpm --filter @sellwasl/api exec vitest run test/stock.test.ts` | Un fichier | Docker |

Rapports : `coverage/index.html` dans chaque paquet ; `apps/web/playwright-report/index.html` pour les parcours (traces et captures des échecs dans `apps/web/test-results`).

Dans la CI GitHub (phase 29, [ci-cd.md](ci-cd.md)), `pnpm test` et `pnpm test:e2e` tournent à chaque pull request, dans deux jobs parallèles ; le rapport des parcours en échec est conservé 7 jours (artefact `playwright`).

## 3. Données

- **API** : base `<nom>_test` (`TEST_DATABASE_URL`, sinon `DATABASE_URL` suffixée), recréée par `test/global-setup.ts` : migrations puis `prisma/seed.ts` (deux entreprises : DISTRI-ORAN en prévente, CASHVAN-EST en cash van ; comptes `A-ADM`, `A-SUP`, `A-CPT`, `V07`, `V08`, `L01`, `M01`, `B-*`, `C01`, `C02` ; mot de passe `SellWasl@2026`).
- **Parcours** : base `sellwasl_e2e`, recréée par `e2e/prepare-db.mjs` avant le démarrage de l'API (port 3101) ; Web sur le port 3100.
- **Mobile et offline** : jeux de données de `packages/offline/src/fixtures.ts` (vendeur V07, client « Épicerie Amine », thon à 5 800 DA le carton, palier à 10 cartons).
- **Dates** : chaque suite réserve ses dates (samedis lointains) ; un test qui dépend du jour réel s'adapte à une journée existante (`devices.test.ts`).

## 4. Couverture

Mesurée à chaque `pnpm test` ; seuils un peu sous le niveau atteint (un recul fait échouer) :

| Paquet | Instructions | Branches | Fonctions | Lignes |
|---|---|---|---|---|
| API | 87 % | 72 % | 90 % | 89 % |
| business-rules | 92 % | 85 % | 92 % | 93 % |
| offline | 80 % | 60 % | 77 % | 84 % |
| validation | 82 % | 4 % | 24 % | 85 % |
| Web (composants) | 13 % | 10 % | 9 % | 14 % |
| Mobile (écrans) | 18 % | 17 % | 16 % | 19 % |

Le Web et le mobile ont des seuils bas : leurs pages et écrans sont couverts par les parcours Playwright et la logique hors connexion par `packages/offline`, que la mesure de ces paquets ne compte pas. Relever un seuil quand la couverture progresse.

## 5. Particularités à connaître

- **Session Web** : le jeton de rafraîchissement est à usage unique (un jeton rejoué révoque la session). Une session enregistrée ne peut donc servir qu'à un seul test : les parcours ouvrent une session par test, par l'API (`e2e/fixtures.ts`).
- **Limite de débit** : 10 connexions par minute et par IP. Les tests qui se connectent souvent démarrent l'API avec `TRUST_PROXY=1` et présentent une IP par requête (`X-Forwarded-For`).
- **Espace plateforme** : invisible hors de la liste d'IP ; les parcours le testent (404 sans IP autorisée, puis enrôlement du deuxième facteur).
- **Compte bloqué** : 5 mots de passe faux bloquent un compte 15 minutes ; un test qui essaie des mots de passe faux utilise un compte créé pour lui ou un identifiant inconnu.

## 6. Ajouter un test

- **Route de l'API** : un fichier `apps/api/test/<domaine>.test.ts`, `startApp()` et `call()` de `test/helpers.ts`, connexion par `webLogin` ou un téléphone par `Phones` (`test/phone.ts`). La matrice des droits couvre déjà la nouvelle route si elle déclare son droit.
- **Règle métier** : un test à côté de la fonction dans `packages/business-rules`, avec l'exemple chiffré de la règle.
- **Écran Web** : un test de composant si la logique est locale ; un parcours dans `apps/web/e2e` pour un enchaînement de pages (`test.use({ account: 'A-ADM' })`).
- **Écran mobile** : `apps/mobile/__tests__`, état local construit avec `loadState` et `applyOps` de `@sellwasl/offline`, posé dans `fakeSync.local`.
