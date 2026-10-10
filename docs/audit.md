# Journal d'audit — SellWasl

> **Phase 26 — rédigé le 2026-10-10.** Règle : BR-AUD-01 (business-rules.md §20). Catalogue tenu dans `packages/validation/src/audit.ts` ; ce document en reprend la liste.

## 1. Principe

- Table `audit_log` (database.md) : auteur, action, fiche et identifiant, ancienne et nouvelle valeur, motif, appareil, IP, navigateur, date.
- **Ajout seul** : un déclencheur en base refuse toute modification ou suppression (`audit_log_append_only`).
- **Contexte automatique** : l'IP et le navigateur de chaque requête, et l'appareil de la session (téléphone), sont ajoutés par `AuditService` quand l'appel ne les donne pas. Les tâches de nuit écrivent sans contexte.
- **Catalogue typé** : `AuditEntry.action` et `AuditEntry.entity` ne prennent que les codes du catalogue ; une action ou une fiche sans libellé ne compile pas.
- **Aucun secret** : ni mot de passe, ni empreinte, ni jeton dans l'ancienne ou la nouvelle valeur (testé).
- Les mouvements de stock automatiques (réservations, libérations) sont tracés par le registre `stock_movement`, pas en double dans l'audit.
- L'audit des actions du support (`platform_audit_log`) sera consultable après le MVP.

## 2. Consultation

- Réservée à l'admin (`audit.read`, rbac.md). Écran Web « Journal d'audit » (menu Administration) : filtres période (30 derniers jours par défaut), utilisateur, fiche, action ; détail avec les champs changés ; export CSV.
- API : `GET /audit` (paginé, api.md §1.2) et `GET /audit/export` (CSV, 10 000 lignes au plus, les plus récentes) — api.md §5.

## 3. Actions

### Connexions, comptes et appareils

| Code | Libellé |
|---|---|
| `auth.login` | Connexion |
| `auth.logout` | Déconnexion |
| `user.create` | Utilisateur créé |
| `user.update` | Utilisateur modifié (dont le rôle) |
| `user.disable` | Utilisateur désactivé |
| `user.enable` | Utilisateur réactivé |
| `user.password.change` | Mot de passe changé |
| `user.password.reset` | Mot de passe réinitialisé |
| `session.revoke` | Session fermée |
| `session.revoke_all` | Toutes les sessions fermées |
| `device.activation_code.create` | Code d'activation d'appareil créé |
| `device.activate` | Appareil associé à un profil |
| `device.block` | Appareil bloqué |
| `device.unblock` | Appareil débloqué |
| `device.revoke` | Appareil révoqué |

### Entreprise et paramètres

| Code | Libellé |
|---|---|
| `company.create` | Entreprise créée |
| `company.mode.change` | Mode de vente changé (modules activés ou désactivés) |
| `company.suspend` | Entreprise suspendue |
| `company.reactivate` | Entreprise réactivée |
| `settings.update` | Paramètres modifiés |
| `customer_type.create` | Type de client créé |
| `customer_type.update` | Type de client modifié |
| `holiday.create` | Jour férié ajouté |
| `holiday.delete` | Jour férié retiré |
| `reason.create` | Motif créé |
| `reason.update` | Motif modifié |
| `warehouse.create` | Entrepôt créé |
| `warehouse.update` | Entrepôt modifié |
| `import.customers` | Import de clients |
| `import.products` | Import de produits |

### Catalogue et prix

| Code | Libellé |
|---|---|
| `product.create` | Produit créé |
| `product.update` | Produit modifié |
| `product.photo.set` | Photo de produit changée |
| `product.photo.remove` | Photo de produit retirée |
| `product_unit.create` | Unité créée |
| `product_unit.update` | Unité modifiée |
| `product_variant.create` | Parfum créé |
| `product_variant.update` | Parfum modifié |
| `product_range.create` | Gamme créée |
| `product_range.update` | Gamme modifiée |
| `product_category.create` | Catégorie créée |
| `product_category.update` | Catégorie modifiée |
| `supplier.create` | Fournisseur créé |
| `supplier.update` | Fournisseur modifié |
| `price.update_grid` | Prix changés |
| `price_tier.create` | Palier créé |
| `price_tier.update` | Palier modifié |
| `price_tier.delete` | Palier retiré |
| `bonus_rule.create` | Bonus créé |
| `bonus_rule.update` | Bonus modifié |
| `bonus_rule.delete` | Bonus retiré |

### Clients, secteurs et planning

| Code | Libellé |
|---|---|
| `customer.create` | Client créé |
| `customer.update` | Client modifié |
| `customer.validate` | Client validé |
| `customer.disable` | Client désactivé |
| `customer.enable` | Client réactivé |
| `customer.assign_part` | Partie du client forcée |
| `customer.reschedule` | Visite reprogrammée |
| `customer.reschedule_cancel` | Reprogrammation annulée |
| `territory.create` | Secteur créé |
| `territory.update` | Secteur modifié (dont vendeur et livreur affectés) |
| `territory.parts` | Polygones du secteur modifiés |
| `territory.schedule` | Planning du secteur modifié |

### Supervision

| Code | Libellé |
|---|---|
| `quota.update` | Quotas modifiés |
| `objective.update` | Objectifs modifiés |
| `objective.cap` | Plafond des objectifs modifié |
| `objective.payment_delay` | Délai de paiement des objectifs modifié |
| `driver_objectives.update` | Objectifs des livreurs modifiés |
| `driver_objectives.settings` | Réglages des objectifs des livreurs modifiés |
| `pending_line.accept` | Ligne en attente acceptée |
| `pending_line.refuse` | Ligne en attente refusée |

### Journées et terrain

| Code | Libellé |
|---|---|
| `workday.start` | Journée démarrée |
| `workday.close` | Journée clôturée |
| `workday.force_close` | Journée clôturée d'office |
| `workday.reopen` | Journée rouverte |
| `workday.clock_skew` | Heure du téléphone décalée |
| `visit.start` | Visite commencée |
| `visit.close` | Visite terminée |
| `visit.close_no_order` | Visite terminée sans commande |
| `order.confirm` | Commande confirmée |
| `order.update` | Commande modifiée |
| `order.cancel` | Commande annulée |
| `payment.debt` | Dette encaissée |
| `receipt.reprint` | Bon réimprimé |

### Préparation, livraison et cash van

| Code | Libellé |
|---|---|
| `route.prepare` | Préparation lancée |
| `route.launch` | Tournée lancée |
| `load.plan` | Chargement prévu |
| `load.validate` | Chargement validé |
| `load.receive` | Chargement reçu |
| `truck.check` | Camion pointé |
| `delivery.confirm` | Livraison confirmée |
| `delivery.fail` | Livraison en échec |
| `sale.confirm` | Vente confirmée |
| `lost_demand.create` | Vente perdue enregistrée |
| `refusal.contest` | Refus contesté |
| `refusal.decide` | Contestation tranchée |

### Stock

| Code | Libellé |
|---|---|
| `stock.receive` | Entrée de stock |
| `stock.thresholds` | Seuils de stock modifiés |
| `inventory.validate` | Inventaire validé |
| `unload.validate` | Déchargement validé |

### Comptabilité

| Code | Libellé |
|---|---|
| `settlement.create` | Versement enregistré |
| `discrepancy.review` | Écart en analyse |
| `discrepancy.decide` | Écart tranché |

### Paie

| Code | Libellé |
|---|---|
| `compensation.create` | Rémunération fixée |
| `payroll.settings` | Réglages de la paie modifiés |
| `payroll.create` | Paie du mois créée |
| `payroll.calculate` | Paie calculée |
| `payroll.adjustment` | Ajustement de paie |
| `payroll.approve` | Paie approuvée |
| `payroll.pay` | Paie payée |
| `payroll.close` | Paie clôturée |
| `advance.create` | Acompte demandé |
| `advance.approve` | Acompte approuvé |
| `advance.reject` | Acompte refusé |
| `advance.pay` | Acompte payé |
| `deduction.create` | Retenue créée |
| `deduction.approve` | Retenue approuvée |
| `deduction.reject` | Retenue refusée |
| `incentive_rule.create` | Règle de prime créée |
| `incentive_rule.update` | Règle de prime modifiée |
| `incentive.calculate` | Primes calculées |
| `incentive.validate` | Prime validée |
| `incentive.reject` | Prime refusée |

## 4. Fiches

| Code | Libellé |
|---|---|
| `BonusRule` | Bonus |
| `Company` | Entreprise |
| `CompanySettings` | Paramètres |
| `Customer` | Client |
| `CustomerType` | Type de client |
| `Delivery` | Livraison |
| `DeliveryRoute` | Tournée |
| `Device` | Appareil |
| `Discrepancy` | Écart |
| `DriverObjective` | Objectif de livreur |
| `EmployeeCompensation` | Rémunération |
| `Holiday` | Jour férié |
| `ImportJob` | Import |
| `Incentive` | Prime |
| `IncentiveRule` | Règle de prime |
| `InventoryCount` | Inventaire |
| `Load` | Chargement |
| `Objective` | Objectif |
| `Order` | Commande |
| `OrderLine` | Ligne de commande |
| `Payment` | Paiement |
| `PayrollAdjustment` | Ajustement de paie |
| `PayrollDeduction` | Retenue |
| `PayrollPayment` | Paiement de paie |
| `PayrollPeriod` | Paie |
| `PriceTier` | Palier |
| `Product` | Produit |
| `ProductCategory` | Catégorie |
| `ProductRange` | Gamme |
| `ProductUnit` | Unité |
| `ProductVariant` | Parfum |
| `Quota` | Quota |
| `Reason` | Motif |
| `SalaryAdvance` | Acompte |
| `Session` | Session |
| `StockReceipt` | Entrée de stock |
| `Supplier` | Fournisseur |
| `Territory` | Secteur |
| `TerritoryPart` | Partie de secteur |
| `Unload` | Déchargement |
| `User` | Utilisateur |
| `Visit` | Visite |
| `Warehouse` | Entrepôt |
| `Workday` | Journée |

## 5. Correspondance avec BR-AUD-01

| BR-AUD-01 | Actions |
|---|---|
| Connexions, associations et révocations d'appareils | `auth.login`, `auth.logout`, `device.activate`, `device.revoke`, `device.block`, `device.unblock`, `session.revoke` |
| Journées : démarrage, clôture, clôture d'office, réouverture | `workday.start`, `workday.close`, `workday.force_close`, `workday.reopen` |
| Produits et parfums : création, modification, désactivation | `product.*`, `product_variant.*`, `product_unit.*` |
| Prix, paliers, bonus, quotas, objectifs | `price.update_grid`, `price_tier.*`, `bonus_rule.*`, `quota.update`, `objective.*`, `driver_objectives.*` |
| Client : modification, désactivation, forçage de la partie | `customer.update`, `customer.disable`, `customer.assign_part` |
| Polygones et planning | `territory.parts`, `territory.schedule`, `customer.reschedule` |
| Lignes en attente, lancement de la préparation | `pending_line.accept`, `pending_line.refuse`, `route.prepare`, `route.launch` |
| Stock, inventaires, écarts | `stock.receive`, `inventory.validate`, `load.*`, `unload.validate`, `truck.check`, `discrepancy.*` |
| Encaissements, versements, écarts | `delivery.confirm`, `sale.confirm`, `payment.debt`, `settlement.create`, `discrepancy.*` |
| Réimpressions | `receipt.reprint` |
| Rôle, affectation de secteur, modules (plan_VF) | `user.update`, `territory.update`, `company.mode.change` |
