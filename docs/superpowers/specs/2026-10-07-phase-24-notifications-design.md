# Phase 24 — Notifications : conception

> Validée le 2026-10-07. Plan : `docs/superpowers/plans/2026-10-07-phase-24-notifications.md`.
> Références : plan_VF.md (phase 24), business-rules.md §19 (BR-NOT-01 à 03), architecture.md §15.2.

## 1. Objectif et décisions

Prévenir chaque utilisateur des événements qui le concernent : dans l'application (Web et
téléphone) et par notification push sur le téléphone.

| Sujet | Décision (2026-10-07) |
|---|---|
| Canaux | Notifications internes (Web, téléphone) et **push** sur le téléphone. **Ni SMS, ni WhatsApp** (demande de l'utilisateur) ; email après le MVP. |
| Destinataires des événements « superviseur » | Selon les droits : les utilisateurs actifs dont le rôle a le droit de l'événement (module actif). |
| Cloche du Web | Nombre de non lues rafraîchi toutes les 60 s et au retour sur l'onglet. |
| Préférences | Aucune dans le MVP. |
| Fournisseur push | Expo Push (FCM), derrière l'interface `PushProvider` (architecture §15.2). |

## 2. Serveur

### 2.1 Enregistrement

- `NotificationsService.notify(tx, input)` crée les lignes `Notification` dans la transaction de
  l'action (rien n'est notifié si l'action échoue).
- `input` : `companyId`, `type`, `title`, `body`, `data` (`{ href?, … }`), destinataires
  `{ userIds?: string[]; permission?: string }`, `actorUserId` (jamais notifié).
- Par droit : utilisateurs `ACTIVE` de l'entreprise dont le rôle a la permission, avec le module
  de la permission actif (`isPermissionModuleActive`).

### 2.2 Envoi push

- `PushDispatcher` : toutes les 10 s (`@nestjs/schedule`) et après chaque `notify` (au plus tôt
  après la validation de la transaction). Verrou `pg_try_advisory_lock` pour un seul envoyeur.
- Prend les notifications `pushedAt IS NULL` de moins de 24 h ; cibles : appareils `ACTIVE` de
  l'utilisateur avec `pushToken`, et, pour `DEVICE_REVOKED`, l'appareil révoqué indiqué dans
  `data.deviceId`. Sans cible : `pushedAt` posé quand même (rien à envoyer).
- Envoi par lots de 100 ; `pushedAt` posé après l'envoi. Un jeton refusé (`DeviceNotRegistered`)
  est effacé de l'appareil.
- `PushProvider` : `ExpoPushProvider` (`https://exp.host/--/api/v2/push/send`, `EXPO_ACCESS_TOKEN`
  facultatif) ; `MemoryPushProvider` quand `PUSH_PROVIDER=memory` (tests, développement).

### 2.3 Routes (chacun voit seulement les siennes)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/notifications?unread=true&cursor=&limit=` | `Page<NotificationDto>`, récentes d'abord |
| GET | `/notifications/unread-count` | `{ count }` |
| PATCH | `/notifications/{id}/read` | Marque lue |
| POST | `/notifications/read-all` | Toutes lues |

`NotificationDto` : `id`, `type`, `title`, `body`, `href`, `createdAt`, `readAt`.

### 2.4 Événements

| Type | Déclencheur | Destinataires | Lien |
|---|---|---|---|
| `PENDING_LINES` | `order.confirm` / `order.update` avec ligne `PENDING` | `pending_lines.process` | `/app/attente` |
| `NEW_CUSTOMER` | `customer.create` | `customers.update` | `/app/clients` |
| `OUT_OF_ZONE_VISIT` | `visit.start` hors zone | `visits.read` | `/app/suivi` |
| `LOAD_GAP` | `load.receive` / `truck.check` avec écart | `loads.read` | `/app/stock` |
| `UNLOAD_GAP` | déchargement validé avec écart | `discrepancies.read` | `/app/ecarts` |
| `SETTLEMENT_GAP` | versement avec écart | `settlements.read` | `/app/versements` |
| `WORKDAY_OFFLINE` | `workday.start` / `workday.close` avec `offline` | `workdays.read` | `/app/journees` |
| `WORKDAY_REOPENED` | réouverture par le superviseur | l'utilisateur de la journée | — |
| `QUOTA_CHANGED` | quotas enregistrés pour aujourd'hui ou plus tard | chaque vendeur concerné | — |
| `PENDING_DECIDED` | ligne en attente acceptée ou refusée | le vendeur de la commande | — |
| `DEVICE_REVOKED` | appareil révoqué | l'utilisateur, push vers l'appareil révoqué | — |

## 3. Téléphone

- `expo-notifications` : après la connexion, autorisation, jeton Expo (`projectId` d'EAS),
  `POST /devices/push-token`. Notification reçue application ouverte : bannière. Toucher : écran
  Notifications du rôle.
- Sorte de synchronisation `notification` (mode rows, ses notifications des 30 derniers jours) ;
  opération `notification.read` (`{ notificationIds }`, droit `workdays.own`) mise en file :
  marquer lu marche hors connexion.
- Écran Notifications partagé (`seller/notifications`, `driver/notifications`) ; carte
  « N notifications non lues » sur les accueils.

## 4. Web

- Cloche dans l'en-tête de l'espace entreprise (`AppShell`) : pastille du nombre de non lues ;
  panneau des 10 dernières, « Tout marquer comme lu », clic → lien de la notification (et lue).
- Page `/app/notifications` (menu « Moi ») : historique paginé.

## 5. Tests et limites

- API : chaque événement crée la notification attendue pour les bons destinataires, pas pour
  l'auteur ; lecture, compteur et pages limités à ses notifications ; l'envoyeur envoie une fois,
  ignore les appareils révoqués sauf pour `DEVICE_REVOKED`, efface un jeton refusé ; sorte
  `notification` et opération `notification.read`.
- Limite : l'envoi réel exige un projet Firebase et la clé FCM dans EAS (documentés dans
  `docs/notifications.md`) et un vrai téléphone ; vérification manuelle décrite.
