# Notifications

> **Phase 24 — réalisée le 2026-10-07.** Spec : `docs/superpowers/specs/2026-10-07-phase-24-notifications-design.md`.
> Règles : [business-rules.md §19](business-rules.md) (BR-NOT-01 à 03). Architecture : §15.2.

Canaux : notifications **dans l'application** (Web et téléphone) et **push** sur le téléphone.
Ni SMS, ni WhatsApp (décision du 2026-10-07) ; l'email viendra après le MVP derrière la même
interface `PushProvider`.

## 1. Événements

| Type | Quand | Qui | Lien Web |
|---|---|---|---|
| `PENDING_LINES` | Commande (ou modification) avec une ligne « en attente » | Droit `pending_lines.process` | Lignes en attente |
| `NEW_CUSTOMER` | Client créé sur le terrain | Droit `customers.update` | Clients |
| `OUT_OF_ZONE_VISIT` | Visite sur place loin du client | Droit `visits.read` | Suivi du jour |
| `LOAD_GAP` | Pointage ou réception du camion avec écart | Droit `loads.read` | Stock |
| `UNLOAD_GAP` | Déchargement avec écart | Droit `discrepancies.read` | Écarts |
| `SETTLEMENT_GAP` | Versement avec écart | Droit `settlements.read` | Comptabilité |
| `WORKDAY_OFFLINE` | Journée démarrée ou clôturée sans réseau | Droit `workdays.read` | Journées |
| `WORKDAY_REOPENED` | Journée rouverte par le superviseur | L'utilisateur de la journée | — |
| `QUOTA_CHANGED` | Quotas enregistrés | Chaque vendeur concerné | — |
| `PENDING_DECIDED` | Ligne en attente acceptée ou refusée | Le vendeur de la commande | — |
| `DEVICE_REVOKED` | Appareil révoqué | L'utilisateur (push vers le téléphone révoqué) | — |

- Destinataires « par droit » : utilisateurs actifs de l'entreprise dont le rôle a ce droit, si le
  module du droit est actif. **L'auteur de l'action n'est jamais notifié.**
- La notification est enregistrée dans la transaction de l'action : une action refusée ne
  notifie personne.
- Pas de préférences par utilisateur dans le MVP.

## 2. Envoi push

- `PushDispatcher` passe toutes les 10 secondes et juste après chaque action. Il prend les
  notifications pas encore poussées (`pushedAt` vide, moins de 24 h), les envoie par lots de 100
  aux téléphones **actifs** qui ont un jeton, et note `pushedAt`. `DEVICE_REVOKED` part vers le
  téléphone révoqué lui-même.
- Un verrou PostgreSQL (`pg_try_advisory_xact_lock`) évite deux envois en parallèle (plusieurs
  instances de l'API).
- Jeton refusé par Expo (`DeviceNotRegistered`) : effacé ; le téléphone le renverra à la
  prochaine connexion.
- Variables : `PUSH_PROVIDER=memory` (développement, tests : rien ne sort), `EXPO_ACCESS_TOKEN`
  (facultatif, recommandé en production), `PUSH_AUTO=off` (tests : pas d'envoi automatique).

## 3. Web

Cloche dans l'en-tête de l'espace entreprise : nombre de non lues (rafraîchi toutes les 60 s et
au retour sur l'onglet), panneau des 10 dernières, « Tout marquer comme lu ». Page
« Notifications » (menu Moi) : historique, filtre « non lues ». Une notification ouverte est lue.

## 4. Téléphone

- Après la connexion, l'application demande l'autorisation, obtient un jeton Expo et l'envoie
  (`PUT /devices/push-token`).
- Les notifications arrivent aussi par la synchronisation (sorte `notification`, 30 jours) :
  lisibles hors connexion. « Lu » est une opération de la file (`notification.read`).
- Carte « Notifications » sur les accueils du vendeur et du livreur ; toucher un push ouvre
  l'écran Notifications ; un push reçu application ouverte relance une synchronisation.

## 5. Configuration à faire (une fois)

Le push sur Android passe par Firebase Cloud Messaging. Sans ces étapes, tout fonctionne sauf la
notification push elle-même (les notifications restent dans l'application).

1. **Projet EAS** : `cd apps/mobile && npx eas-cli@latest init` (ajoute
   `expo.extra.eas.projectId` dans `app.json`).
2. **Projet Firebase** (console.firebase.google.com) : ajouter une application Android avec le
   package de `app.json` (`android.package`) ; télécharger `google-services.json` dans
   `apps/mobile/` et ajouter `"googleServicesFile": "./google-services.json"` dans
   `expo.android` de `app.json`.
3. **Clé FCM v1 pour Expo** : Firebase → Paramètres du projet → Comptes de service → générer une
   clé privée (JSON) ; puis `npx eas-cli@latest credentials` → Android → « Google Service Account
   Key for Push Notifications (FCM V1) » → téléverser la clé.
4. **Recompiler l'application** (`expo-notifications` est un module natif ; le push ne marche pas
   dans Expo Go sur Android).
5. **Serveur** : laisser `PUSH_PROVIDER` vide en production (Expo Push) ; facultatif :
   `EXPO_ACCESS_TOKEN` (expo.dev → Access tokens) avec l'option « push security » activée.

## 6. Vérification manuelle

1. Téléphone d'un vendeur associé et connecté, autorisation acceptée.
2. Sur le Web, modifier un quota de ce vendeur pour aujourd'hui : push « Quota modifié » en
   quelques secondes ; toucher → écran Notifications.
3. Sur le téléphone, prendre une commande au-delà du quota : cloche du superviseur à 1 ;
   panneau → « Lignes en attente » → la page Lignes en attente s'ouvre.
4. Refuser la ligne : push « Lignes en attente refusées » chez le vendeur.
5. Mode avion : l'écran Notifications reste lisible ; « Tout marquer comme lu » ; au retour du
   réseau, la lecture part au serveur.
6. Révoquer l'appareil : le téléphone reçoit « Appareil révoqué ».
