# Page Statistiques : graphiques des ventes et des retours

> Conception validée le 2026-10-16 dans la conversation ; réalisée le même jour. Pages voisines : Rapports (tableaux et exports), Analyse des retours (tableaux par axe), Accueil (chiffres du jour).

## Décisions

| Sujet | Décision |
|---|---|
| Emplacement | Nouvelle page `/app/statistiques`, entrée « Statistiques » sous Rapports (`reports.read`, module Analyse) |
| Affichage | Un graphique à la fois, choisi par des onglets : Ventes, Classement, Top 10, Retours |
| Filtres | Période (raccourcis existants), secteur, vendeur, livreur, produit ; chaque graphique n'affiche que les siens, les valeurs sont gardées d'un graphique à l'autre ; une liste inaccessible est masquée |
| Ventes | Courbe du chiffre d'affaires ou du nombre de commandes ; filtres secteur, vendeur, produit |
| Classement | Barres des vendeurs (CA, visites, conversion) ou des livreurs (livrées, partielles, échecs) ; filtre secteur |
| Top 10 | Barres des 10 produits ou clients au plus fort CA ; filtres secteur, vendeur |
| Retours | Trois courbes (refusé, retourné, revendu, en DA), taux de refus au survol ; filtres secteur, vendeur, livreur, produit ; seulement avec le module Analyse des retours |
| Pas de temps | Jour jusqu'à 62 jours, semaine jusqu'à 183 (commençant au jour `payroll.weekStartsOn`, samedi par défaut), mois au-delà ; périodes vides à 0 (`packages/business-rules/src/trend.ts`) |

## API

- `GET /reports/sales-trend` : mêmes commandes que le rapport commercial (hors brouillons et annulées) ; avec un produit, le CA est la somme des lignes de ce produit (le rapport commercial compte le total des commandes qui le contiennent).
- `GET /returns/trend` : mêmes faits et filtres que l'analyse des retours ; taux de refus = commandes refusées / commandes présentées, vide sous le volume minimum.
- Classement et Top 10 réutilisent `/reports/presales`, `/reports/delivery`, `/reports/commercial`.

## Graphiques

`TrendChart` (`apps/web/src/components/charts.tsx`) : une ou plusieurs séries sur une seule échelle ; repère et infobulle au survol de chaque période ; légende dès deux séries ; tracés plein, tirets, pointillés en plus de la couleur (rouge, orange, vert : séparation pour les daltoniens à la limite, d'où le second repère ; contraste de l'orange faible, d'où le tableau « Voir les valeurs »). Barres : `BarChart` existant.

## Tests

`trend.test.ts` (pas de temps), `statistics.test.ts` (API : jour, produit, vendeur, 90 jours par semaine, totaux égaux au rapport commercial, retours par livreur et produit, module), `charts.test.tsx`, `statistiques/page.test.tsx`, `labels.test.ts`.
