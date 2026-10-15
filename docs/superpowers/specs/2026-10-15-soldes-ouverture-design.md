# Soldes d'ouverture des dettes clients

> Spec validée le 2026-10-15. Règles : `docs/business-rules.md` (BR-PAY-02 à 05, nouvelle BR-PAY-09), BR-IO-01. Cas d'usage : UC-83 (import). Déploiement : `docs/deployment.md` §8.

## 1. Objectif

Le jour où une entreprise passe à SellWasl, chaque client doit porter la dette qu'il avait dans l'ancien système, pour que le plafond de crédit (BR-PAY-03), l'encaissement des dettes en tournée (BR-PAY-05), les dettes du comptable et les exports soient justes dès le premier jour. Aujourd'hui, une dette ne naît que d'une vente à crédit dans SellWasl.

## 2. Décisions

| Sujet | Décision |
|---|---|
| Portée | Dettes seulement. Pas d'avance d'ouverture : le MVP n'a pas d'avance client (BR-PAY-04). |
| Droits | Nouvelle permission `debts.opening`, par défaut à `COMPANY_ADMIN` et `COMPTABLE`, réglable par l'entreprise. |
| Saisie | Par montant cible : sur la fiche client, ou par un import CSV dédié (`code;nom;dette`). |
| Correction | Possible tant que le client n'a aucune autre écriture de dette ; ensuite le solde est figé. |
| Import des clients | Inchangé. Il ne crée que des clients, souvent avant la bascule : les soldes s'importent à part, le soir de la bascule. |
| Mobile | Aucun changement : la dette mise à jour descend par la synchronisation habituelle. |
| Hors portée | Import Excel, correspondance des colonnes, pack de migration, import KML des secteurs (après le MVP, ajoutés à `plan_VF.md`). |

## 3. Règle BR-PAY-09 (à ajouter à `docs/business-rules.md`)

**BR-PAY-09** — **Solde d'ouverture** : à la mise en service, l'admin ou le comptable (`debts.opening`) inscrit la dette que chaque client avait dans l'ancien système, en DA, entier positif ou nul. Le solde d'ouverture est la somme des écritures `OPENING_BALANCE` du client. Il reste modifiable tant que le client n'a aucune autre écriture de dette (vente à crédit, encaissement) ; ensuite il est figé. Chaque saisie est auditée.

BR-PAY-04 devient : `Dette du client = solde d'ouverture + somme des restes à crédit − somme des paiements de dette`.

## 4. Données

- `DebtEntryKind` : nouvelle valeur `OPENING_BALANCE`. Écriture sans paiement (`payment_id` nul), `occurred_at` = moment de la saisie.
- `ImportKind` : nouvelle valeur `OPENING_DEBTS`.
- Permission `debts.opening` (« Inscrire les soldes d'ouverture des dettes ») : ajoutée au catalogue, donnée aux rôles `COMPANY_ADMIN` et `COMPTABLE` des entreprises existantes par une migration de données, et aux nouveaux rôles par `DEFAULT_ROLE_PERMISSIONS` (`packages/business-rules/src/permissions.ts`).
- Une migration Prisma pour les deux valeurs d'enum et la permission.

## 5. Serveur

### 5.1 Service `OpeningDebtService` (`apps/api/src/customers/opening-debt.service.ts`)

`set(tx, actor, customerId, target: number): Promise<{ openingDebtAmount; debtAmount; changed: boolean }>`

1. Verrouille le client (`SELECT … FOR UPDATE`) : une vente à crédit synchronisée en même temps ne peut pas s'intercaler.
2. Client introuvable dans l'entreprise, ou supprimé : 404.
3. Lit ses écritures de dette. S'il en existe une d'un autre type que `OPENING_BALANCE` : refus 422 `BUSINESS_RULE` (`rule: 'BR-PAY-09'`), « Solde figé : le client a déjà des opérations de dette dans SellWasl. »
4. `current` = somme des `OPENING_BALANCE` ; `delta = target − current`. Si `delta = 0` : rien n'est écrit, `changed: false`.
5. Sinon : écriture `OPENING_BALANCE` de montant `delta`, `debtAmount += delta`, `version + 1` (même façon que `debt.service.ts`).
6. Audit `debt.opening`, entité `Customer`, `before: { openingDebtAmount: current }`, `after: { openingDebtAmount: target }`. Pas d'audit par ligne lors d'un import (§5.3).

`state(customerId)` : `{ openingDebtAmount, openingDebtEditable }`, utilisé par le détail du client.

### 5.2 Fiche client

- `PUT /customers/:id/opening-debt`, corps `{ amount: entier ≥ 0, ≤ 1 000 000 000 }` (schéma Zod dans `@sellwasl/validation`), permission `debts.opening`. Renvoie le client mis à jour avec ses deux nouveaux champs.
- `GET /customers/:id/opening-debt` (permission `debts.opening`) renvoie `{ openingDebtAmount, openingDebtEditable, debtAmount }` ; `CustomerDto` ne change pas (il sert aussi à la synchronisation mobile).

### 5.3 Import des soldes

Le mécanisme d'import existant (fichier conservé, aperçu, confirmation, revérification à la confirmation) reçoit le type `OPENING_DEBTS`, vérifié par `OpeningDebtImportService` (`apps/api/src/imports/opening-debt-import.service.ts`), sur le modèle de `ProductImportService`.

Routes (`OpeningDebtsController`, permission `debts.opening`) :

| Route | Rôle |
|---|---|
| `GET /opening-debts/template` | Modèle CSV `code;nom;dette`, avec BOM comme les autres modèles |
| `POST /opening-debts/imports` | Fichier → aperçu |
| `GET /opening-debts/imports/:id` | Aperçu ; 404 si l'import n'est pas de type `OPENING_DEBTS` |
| `POST /opening-debts/imports/:id/confirm` | Confirmation ; même contrôle de type |

Les routes de `/imports` refusent le type `OPENING_DEBTS` (le schéma `kind` reste `CUSTOMERS | PRODUCTS`), et `GET /imports/:id`, `POST /imports/:id/confirm` renvoient 404 pour un import `OPENING_DEBTS` : `imports.run` ne donne pas accès aux soldes, et `debts.opening` ne donne pas accès aux autres imports.

Vérification de chaque ligne :

- colonnes obligatoires `code` et `dette` ; `nom` facultatif, ignoré (aide à la relecture) ;
- code inconnu dans l'entreprise (comparaison sans tenir compte de la casse) : erreur ;
- code présent deux fois dans le fichier : erreur sur la seconde ligne ;
- montant non entier, négatif ou trop grand : erreur ;
- client figé (§5.1, étape 3) : erreur « solde figé » ;
- au plus `MAX_ROWS` lignes, comme les autres imports.

Aperçu : colonnes `Code`, `Client`, `Solde actuel`, `Nouveau solde`. Les clients absents du fichier ne changent pas. À la confirmation, chaque ligne valide passe par `OpeningDebtService.set` dans la transaction de l'import ; une seule ligne d'audit `import.opening_debts` avec le nombre de clients modifiés.

## 6. Web

- **Comptabilité** : onglet « Soldes d'ouverture » dans `AccountingTabs` (permission `debts.opening`), page `/app/soldes-ouverture` construite sur le modèle de `clients/import/page.tsx` : modèle à télécharger, envoi, aperçu avec erreurs, confirmation, résultat.
- **Fiche client** (`CustomerDetail` de `clients/page.tsx`) : ligne « Solde d'ouverture » ; bouton « Modifier » avec `debts.opening` et `openingDebtEditable`, ouvrant un petit formulaire du montant ; solde figé : la ligne l'indique.
- Composants, libellés et formats suivent les pages existantes (processus ui-consistency).

## 7. Tests

API (Vitest sur PostgreSQL) :

- saisie, correction (deux écritures, historique complet), retour à 0, montant identique sans écriture ;
- solde figé après une vente à crédit, et après un encaissement de dette ;
- refus sans `debts.opening` (vendeur) ; accès du comptable ; isolation entre entreprises ;
- plafond de crédit (BR-PAY-03) calculé avec le solde d'ouverture ;
- import : chaque type d'erreur, aperçu, confirmation, revérification (client figé entre l'aperçu et la confirmation), audit unique ;
- cloisonnement des routes : `/imports/:id` refuse un import `OPENING_DEBTS`, et inversement.

Web (Vitest) : onglet visible selon la permission, page d'import, formulaire de la fiche client (modifiable et figé).

## 8. Documentation

`docs/business-rules.md` (BR-PAY-09, BR-PAY-04), `docs/rbac.md` (permission et matrice), `docs/api.md` (routes), `docs/audit.md` (`debt.opening`, `import.opening_debts`), `docs/database.md` (valeurs d'enum), `docs/deployment.md` §8 (le soir de la bascule : inventaire du dépôt, puis import des soldes, avant la première journée), `plan_VF.md` (tâche faite et tâches « après le MVP » de la migration).
