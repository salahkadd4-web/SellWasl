# Refonte UX/UI du mobile : conception

> Rédigé le 2026-10-12 d'après le prompt de refonte et les maquettes fournies (accueil, liste des
> clients, visites, commande) ; validé en conversation, réalisé en une seule fois (« fait tout dans
> une seule tâche »). Le questionnaire des maquettes est exclu. Produits à parfums : une ligne par
> produit.

## 1. Existant réutilisé (vérifié)

Clients du jour ou du secteur, état visité (BR-VIS-06), dette, distance (`useFieldCustomers`) ;
itinéraire et appel (`openDirections`, `callCustomer`) ; carte MapLibre (OSM, regroupement) ; panier
calculé sur le téléphone (`useCart`, `priceCart`, quotas, stock du camion), commande hors connexion
(`order.confirm`, `order.update`, `sale.confirm`) ; livraison : préparé/livré, motif de refus
obligatoire sous le préparé, échec avec motif, ajouts depuis le camion ; compteurs de `todayView` et
de la tournée ; état de synchronisation (`useSync`). Aucun nouvel accès à l'API, aucun champ en base.

Absent de SellWasl, donc non affiché : étoiles et classe A/B/C des maquettes (le type de client les
remplace).

## 2. Bibliothèques

- `react-native-gesture-handler` + `react-native-reanimated` (déjà compilées dans la version
  installée, dépendances d'expo-router) : glissements fluides, compatibles avec le défilement.
- `@expo/vector-icons` (Feather, dont dérive Lucide) : icônes, sans recompilation.
- Punaises de la carte : images MapPin rouge et verte dessinées par MapLibre (couche de symboles),
  regroupement conservé.

## 3. Socle

- Style : fond `surface`, cartes blanches arrondies (`radius.lg`), bordures fines, marine
  (`primary`) pour la navigation et les actions, vert (`status.synced`) confirmer, rouge
  (`status.error`) annuler et « à visiter », corail (nouveau `coral`) pour les actions fortes.
  Zones tactiles ≥ 48 px, zones système respectées (`react-native-safe-area-context`).
- Composants (`src/ui/`) : `AppHeader` (menu, titre, cloche), `TabBar` (barre du bas, bouton + central),
  `ActionSheet` (feuille d'actions), `SwipeRow` (ligne à glisser, actions dévoilées à droite),
  `QuantityStepper` ([−] [champ] [+] [✓] [✕]), `MapPinLegend`, `StatTile`, `Segmented`, `Chips`.

## 4. Navigation

- Vendeur et cash van : Accueil · Visites · + · Commandes · Map. « + » : Ajouter un client,
  Catalogue, Pointer le camion (cash van).
- Livreur : Accueil · Tournée · + · Bons du jour · Map. « + » : Pointer le camion, Stock du camion.
- Menu ☰ : Objectifs, Ma paie, Refus (droit et module), Synchronisation, Notifications, Profil,
  Déconnexion — selon les droits et modules, comme aujourd'hui.
- Les écrans de détail (fiche, visite, commande, livraison…) restent dans la pile, sans barre du bas.
- Magasinier hors périmètre (profite du style des composants communs).

## 5. Accueil

- « Bonjour », nom, badge Connecté / Hors ligne (réseau réel).
- Vendeur : clients du secteur actifs, visites réalisées / prévues (%), commandes du jour, montant.
  Livreur : livraisons à faire, faites, restantes, encaissé.
- Carte « Journée » : date, progression ; Démarrer, puis Clôturer (écran de clôture existant).
- Carte « Synchronisation » : dernière synchronisation réussie, état réel (échecs compris),
  bouton Synchroniser.
- Alertes conservées : journée précédente non clôturée, changements à la réception, visite en cours.

## 6. Visites (clients)

- Onglets « Clients du jour (n) » / « Tout le secteur (n) » ; pastilles Tous · À visiter · Visités ·
  Hors programme ; recherche nom, code, adresse, téléphone ; filtres et recherche combinés.
- Carte client : nom, badge type, adresse, pastille d'état, dette, distance ; appui : fiche.
- Glissement vers la gauche : Visiter, Localiser, Appeler (seuil, animation) ; bouton « ⋯ » :
  les mêmes actions sans geste.
- Visiter : écran de visite (la visite ne démarre que par son bouton ; journée démarrée exigée).
  Localiser : Google Maps en navigation ; sans coordonnées, adresse encodée si elle existe, sinon
  message. Appeler : grisé sans numéro.

## 7. Map

- Filtres jour / secteur ; MapPin rouge (visite non réalisée) / vert (réalisée) ; livreur : rouge à
  livrer / vert livrée ; légende visible ; zoom conservé au changement de filtre ; « n sans
  position ».
- Appui sur une punaise : panneau bas (nom, adresse, type, état, Visiter/Livrer, Localiser,
  Appeler).

## 8. Commande

- Produits proposables : photo si elle existe, nom, gamme, prix applicable (`priceCart` sur une
  unité), stock du camion (cash van), quota ; recherche et filtre par gamme.
- Glissement d'un produit : zone sous la ligne — unité, puis [−] [quantité] [+] par parfum ;
  ✓ valide (entiers ≥ 0, stock du camion, quota cash van) et met à jour le panier ; ✕ annule la
  saisie en cours seulement. Retirer du panier : action distincte.
- Récapitulatif : lignes (quantité, prix, sous-total, palier), gratuits, total ; « Retour à la
  visite » (panier conservé) et « Confirmer la commande » (enregistrement existant, double envoi
  impossible).

## 9. Livraison

- Ligne : préparé et livré (la tournée ne transmet pas le commandé : le préparé, maximum livrable,
  fait foi), état Complet / Partiel / Non livré ; glissement ou appui : `QuantityStepper` borné au
  préparé, ✓ applique, ✕ abandonne la correction.
- Sous le préparé : motif de refus obligatoire (BR-RET-01) ; la commande d'origine n'est jamais
  modifiée ; échec avec motif et encaissement inchangés.

## 10. Tests

Écrans (jest-expo) : filtres et compteurs, actions des clients (gestes et « ⋯ »), adresse Google
Maps et cas sans coordonnées / numéro, couleur des punaises, ajout au panier (✓, ✕ sans effet sur
les autres produits, panier conservé au retour), livraison partielle avec motif. CI complète.
