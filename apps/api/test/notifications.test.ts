import type { NotificationDto, Page } from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';

/** Notifications internes et push (phase 24, BR-NOT). */
describe('notifications (phase 24)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let notifications: NotificationsService;
  let supA: string;
  let admA: string;
  const ids: Record<string, { id: string; companyId: string }> = {};

  async function user(code: string, company = 'DISTRI-ORAN') {
    const u = await raw.user.findFirstOrThrow({ where: { code, company: { code: company } } });
    return { id: u.id, companyId: u.companyId };
  }

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    notifications = t.app.get(NotificationsService);
    supA = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    admA = await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM');
    for (const code of ['A-SUP', 'A-ADM', 'A-CPT', 'V07']) ids[code] = await user(code);
    ids['B-SUP'] = await user('B-SUP', 'CASHVAN-EST');
  });
  afterAll(() => t.close());

  const count = (userId: string, type: string) =>
    raw.notification.count({ where: { userId, type } });

  describe('enregistrement (NotificationsService.notify)', () => {
    it('par droit : ceux qui ont le droit, pas l’auteur, pas une autre entreprise', async () => {
      const created = await raw.$transaction((tx) =>
        notifications.notify(tx, {
          companyId: ids['A-SUP']!.companyId,
          type: 'PENDING_LINES',
          title: 'Lignes en attente',
          body: 'Test par droit',
          data: { href: '/app/attente' },
          to: { permission: 'pending_lines.process' },
          actorUserId: ids['A-ADM']!.id,
        }),
      );
      expect(created).toBeGreaterThan(0);
      expect(await count(ids['A-SUP']!.id, 'PENDING_LINES')).toBe(1);
      expect(await count(ids['A-ADM']!.id, 'PENDING_LINES')).toBe(0);
      expect(await count(ids['V07']!.id, 'PENDING_LINES')).toBe(0);
      expect(await count(ids['B-SUP']!.id, 'PENDING_LINES')).toBe(0);
    });

    it('à des utilisateurs précis', async () => {
      await raw.$transaction((tx) =>
        notifications.notify(tx, {
          companyId: ids['V07']!.companyId,
          type: 'QUOTA_CHANGED',
          title: 'Quota modifié',
          body: 'Test direct',
          to: { userIds: [ids['V07']!.id] },
        }),
      );
      expect(await count(ids['V07']!.id, 'QUOTA_CHANGED')).toBe(1);
    });

    it('action annulée : aucune notification', async () => {
      await expect(
        raw.$transaction(async (tx) => {
          await notifications.notify(tx, {
            companyId: ids['V07']!.companyId,
            type: 'WORKDAY_REOPENED',
            title: 'Journée rouverte',
            body: 'Annulée',
            to: { userIds: [ids['V07']!.id] },
          });
          throw new Error('échec de l’action');
        }),
      ).rejects.toThrow('échec');
      expect(await count(ids['V07']!.id, 'WORKDAY_REOPENED')).toBe(0);
    });
  });

  describe('lecture (GET /notifications)', () => {
    it('chacun ne voit que les siennes ; compteur ; lire ; tout lire', async () => {
      const mine = await call<Page<NotificationDto>>(t.url, 'GET', '/notifications', {
        token: supA,
      });
      expect(mine.status).toBe(200);
      expect(mine.body.data.some((n) => n.type === 'PENDING_LINES')).toBe(true);
      expect(mine.body.data.every((n) => n.type !== 'QUOTA_CHANGED')).toBe(true);
      const first = mine.body.data[0]!;
      expect(first).toMatchObject({
        title: 'Lignes en attente',
        href: '/app/attente',
        readAt: null,
      });

      const before = await call<{ count: number }>(t.url, 'GET', '/notifications/unread-count', {
        token: supA,
      });
      expect(before.body.count).toBeGreaterThan(0);

      // Notification d'un autre : introuvable
      const other = await raw.notification.findFirstOrThrow({ where: { userId: ids['V07']!.id } });
      expect(
        (await call(t.url, 'PATCH', `/notifications/${other.id}/read`, { token: supA })).status,
      ).toBe(404);

      const read = await call<NotificationDto>(t.url, 'PATCH', `/notifications/${first.id}/read`, {
        token: supA,
      });
      expect(read.status).toBe(200);
      expect(read.body.readAt).not.toBeNull();
      const unread = await call<Page<NotificationDto>>(t.url, 'GET', '/notifications?unread=true', {
        token: supA,
      });
      expect(unread.body.data.some((n) => n.id === first.id)).toBe(false);

      expect((await call(t.url, 'POST', '/notifications/read-all', { token: supA })).status).toBe(
        204,
      );
      const after = await call<{ count: number }>(t.url, 'GET', '/notifications/unread-count', {
        token: supA,
      });
      expect(after.body.count).toBe(0);
      // L'admin n'a rien reçu : il était l'auteur
      const adm = await call<{ count: number }>(t.url, 'GET', '/notifications/unread-count', {
        token: admA,
      });
      expect(adm.body.count).toBe(0);
    });
  });
});
