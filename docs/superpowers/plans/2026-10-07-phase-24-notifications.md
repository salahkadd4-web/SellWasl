# Phase 24 — Notifications : plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** notifications internes (Web, téléphone) et push sur le téléphone pour les événements BR-NOT.

**Architecture:** un module `notifications` de l'API enregistre les notifications dans la transaction de l'action, un envoyeur les pousse par Expo Push derrière `PushProvider`, le Web les lit (cloche, page) et le téléphone les reçoit par la synchronisation et en push.

**Tech Stack:** NestJS 11 + Prisma 7 ; `@nestjs/schedule` ; Next.js 16 ; Expo SDK 57 (`expo-notifications`).

**Spec:** `docs/superpowers/specs/2026-10-07-phase-24-notifications-design.md`

## Global Constraints

- Canaux : internes et push ; **ni SMS, ni WhatsApp** ; email après le MVP.
- Destinataires « superviseur » : par droit (rôle avec la permission, module actif, utilisateur ACTIVE) ; l'auteur de l'action n'est jamais notifié.
- Cloche du Web : rafraîchie toutes les 60 s et au retour sur l'onglet.
- Pas de préférences par utilisateur.
- Push : Expo Push (`https://exp.host/--/api/v2/push/send`), lots de 100, `PUSH_PROVIDER=memory` en test.
- Envoyeur : toutes les 10 s et juste après une action ; notifications de moins de 24 h ; verrou `pg_try_advisory_lock`.
- Téléphone : notifications des 30 derniers jours par la synchronisation ; « lu » par l'opération `notification.read`.
- Fusion locale dans `main`, sans push. CI locale verte avant la fusion.

## Review Focus

1. L'auteur d'une action qui a lui-même le droit (superviseur qui crée un quota) ne se notifie pas (tâche 3).
2. Notification d'une action annulée (transaction en échec) : aucune ligne, aucun push (tâche 1).
3. Un appareil révoqué ne reçoit plus de push, sauf celui qui annonce sa révocation (tâche 2).
4. Un utilisateur ne peut ni lire ni marquer lue la notification d'un autre (tâche 1).
5. Deux envoyeurs simultanés (deux instances de l'API) n'envoient pas deux fois (tâche 2).

---

### Task 1: Module `notifications` (enregistrement, destinataires, routes)

**Files:** Create `apps/api/src/notifications/{notifications.module,notifications.service,notifications.controller}.ts`, `packages/validation/src/notifications.ts`, `apps/api/test/notifications.test.ts`. Modify `apps/api/src/app.module.ts`, `packages/validation/src/index.ts`.

**Interfaces — Produces:**

```ts
export type NotificationType = 'PENDING_LINES' | 'NEW_CUSTOMER' | 'OUT_OF_ZONE_VISIT' | 'LOAD_GAP'
  | 'UNLOAD_GAP' | 'SETTLEMENT_GAP' | 'WORKDAY_OFFLINE' | 'WORKDAY_REOPENED' | 'QUOTA_CHANGED'
  | 'PENDING_DECIDED' | 'DEVICE_REVOKED';
export interface NotificationDto { id; type: NotificationType; title; body; href: string | null; createdAt; readAt: string | null }
export const notificationListQuerySchema = z.object({ unread: z.enum(['true','false']).optional(), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });
// API
NotificationsService.notify(tx: Prisma.TransactionClient, input: {
  companyId: string; type: NotificationType; title: string; body: string;
  data?: Record<string, unknown> & { href?: string; deviceId?: string };
  to: { userIds?: string[]; permission?: string }; actorUserId?: string | null;
}): Promise<number>   // nombre de notifications créées
```

- [ ] Tests (`notifications.test.ts`) : `notify` par permission → admin et superviseur de DISTRI-ORAN reçoivent, pas l'auteur, pas l'autre entreprise ; par `userIds` ; dans une transaction annulée → aucune ligne ; `GET /notifications` et `unread-count` ne montrent que les siennes ; `PATCH /:id/read` d'une notification d'un autre → 404 ; `read-all` met à zéro.
- [ ] Implémentation, PASS, commit `feat(api): notifications internes (enregistrement, destinataires, lecture)`.

### Task 2: Envoi push (`PushProvider`, envoyeur)

**Files:** Create `apps/api/src/notifications/push.provider.ts` (`PushProvider`, `ExpoPushProvider`, `MemoryPushProvider`, jeton `PUSH_PROVIDER`), `apps/api/src/notifications/push-dispatcher.service.ts`. Test : `apps/api/test/notifications.test.ts`.

**Interfaces — Produces:** `interface PushMessage { to: string; title: string; body: string; data: Record<string, unknown> }` ; `interface PushProvider { send(messages: PushMessage[]): Promise<{ ok: boolean; error?: string }[]> }` ; `PushDispatcher.dispatch(): Promise<number>` (messages envoyés) ; `PushDispatcher.kick(): void`.

- [ ] Tests : notification pour un utilisateur avec appareil actif et jeton → un message, `pushedAt` posé, second `dispatch` → rien ; appareil révoqué → pas de message, sauf `DEVICE_REVOKED` avec `data.deviceId` ; erreur `DeviceNotRegistered` → jeton effacé ; deux `dispatch` en parallèle → un seul envoi.
- [ ] Implémentation (envoyeur sans tenant : `PrismaService` brut, ajouté à la liste du test d'architecture), PASS, commit `feat(api): envoi push (Expo) des notifications`.

### Task 3: Événements BR-NOT

**Files:** Modify `field/order.service.ts`, `field/customer-ops.service.ts`, `field/visit.service.ts`, `delivery/load-receive.service.ts`, `stock/unloads.service.ts`, `accounting/accounting.service.ts`, `field/workday.service.ts`, `supervision/workdays-admin.service.ts`, `supervision/quotas.service.ts`, `supervision/pending-lines.service.ts`, `devices/devices.service.ts` (+ modules : import `NotificationsModule`). Test : `apps/api/test/notifications.test.ts`.

- [ ] Tests (jour réservé `2027-06-26`) : un test par type de la spec §2.4 — l'action déclenche une notification du bon type pour le bon destinataire (lien compris), pas pour l'auteur.
- [ ] Implémentation (`notify` dans la transaction, `kick` après), PASS, commit `feat(api): événements BR-NOT notifiés`.

### Task 4: Téléphone (synchronisation, push, écran)

**Files:** Server : `packages/validation/src/offline.ts` (sorte `notification`, `OPERATION_TYPES` + `notification.read`, `notificationReadPayload`), `apps/api/src/sync/kinds/field.kinds.ts`, handler `notification.read` dans `notifications.service.ts`. Paquet : `packages/offline` (LocalState.notifications, effet `notification.read`, vue `notificationsView`). Mobile : `npx expo install expo-notifications expo-device`, `src/notifications/push.ts` (autorisation, jeton, `POST /devices/push-token`, réponse au toucher), `src/notifications/NotificationsScreen.tsx`, routes `seller/notifications.tsx`, `driver/notifications.tsx`, carte sur les accueils.

- [ ] Tests : API — la sorte `notification` arrive au téléphone, `notification.read` marque lu (et refuse celle d'un autre) ; paquet — effet `notification.read` et `notificationsView` (non lues d'abord).
- [ ] Implémentation, typage mobile, commit `feat: notifications sur le téléphone (synchronisation, push, écran)`.

### Task 5: Web (cloche, page)

**Files:** Create `apps/web/src/components/notification-bell.tsx`, `apps/web/src/app/app/(espace)/notifications/page.tsx`. Modify `app-shell.tsx` (cloche dans l'en-tête, espace entreprise), `lib/navigation.ts` (entrée « Notifications », groupe Moi), `components/icons.tsx` (icône `bell`).

- [ ] Typage Web ; commit `feat(web): cloche et page des notifications`.

### Task 6: Documentation et CI

- [ ] `docs/notifications.md` (événements, destinataires, envoi, configuration Firebase/EAS, vérification manuelle), architecture §15.2, api.md (routes), plan_VF phase 24 cochée (SMS/WhatsApp/email non faits, notés hors MVP par décision).
- [ ] CI locale complète ; commit `docs: notifications ; phase 24 cochée`.
