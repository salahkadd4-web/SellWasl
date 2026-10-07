import type {
  NotificationDto,
  Page,
  ProductDto,
  SyncPullResponse,
  TruckCheckLine,
  UnloadPreviewLine,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PushDispatcher } from '../src/notifications/push-dispatcher.service';
import { MemoryPushProvider, PUSH_PROVIDER } from '../src/notifications/push.provider';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { type Phone, Phones } from './phone';

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
    for (const code of ['A-SUP', 'A-ADM', 'A-CPT', 'V07', 'V08']) ids[code] = await user(code);
    ids['B-SUP'] = await user('B-SUP', 'CASHVAN-EST');
  });
  afterAll(() => t.close());

  // Par texte : d'autres suites ont pu créer des notifications du même type avant celle-ci
  const count = (userId: string, body: string) =>
    raw.notification.count({ where: { userId, body } });

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
      expect(await count(ids['A-SUP']!.id, 'Test par droit')).toBe(1);
      expect(await count(ids['A-ADM']!.id, 'Test par droit')).toBe(0);
      expect(await count(ids['V07']!.id, 'Test par droit')).toBe(0);
      expect(await count(ids['B-SUP']!.id, 'Test par droit')).toBe(0);
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
      expect(await count(ids['V07']!.id, 'Test direct')).toBe(1);
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
      expect(await count(ids['V07']!.id, 'Annulée')).toBe(0);
    });
  });

  describe('lecture (GET /notifications)', () => {
    it('chacun ne voit que les siennes ; compteur ; lire ; tout lire', async () => {
      const mine = await call<Page<NotificationDto>>(t.url, 'GET', '/notifications', {
        token: supA,
      });
      expect(mine.status).toBe(200);
      expect(mine.body.data.every((n) => n.body !== 'Test direct')).toBe(true);
      const first = mine.body.data.find((n) => n.body === 'Test par droit')!;
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
      const adm = await call<Page<NotificationDto>>(t.url, 'GET', '/notifications?limit=100', {
        token: admA,
      });
      expect(adm.body.data.some((n) => n.body === 'Test par droit')).toBe(false);
    });
  });

  describe('envoi push (PushDispatcher)', () => {
    let dispatcher: PushDispatcher;
    let provider: MemoryPushProvider;
    let deviceId: string;

    const notifyV07 = (
      type: 'QUOTA_CHANGED' | 'DEVICE_REVOKED',
      data: Record<string, unknown> = {},
    ) =>
      raw.$transaction((tx) =>
        notifications.notify(tx, {
          companyId: ids['V07']!.companyId,
          type,
          title: 'Titre push',
          body: 'Corps push',
          data,
          to: { userIds: [ids['V07']!.id] },
        }),
      );

    beforeAll(async () => {
      dispatcher = t.app.get(PushDispatcher);
      provider = t.app.get<MemoryPushProvider>(PUSH_PROVIDER);
      // Notifications déjà présentes : envoyées une fois pour toutes
      await dispatcher.dispatch();
      provider.sent.length = 0;
      deviceId = uuidv7();
      // Un seul appareil actif par utilisateur : celui d'une autre suite est révoqué
      await raw.device.updateMany({
        where: { userId: ids['V07']!.id, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await raw.device.create({
        data: {
          id: deviceId,
          companyId: ids['V07']!.companyId,
          userId: ids['V07']!.id,
          series: 'Z',
          status: 'ACTIVE',
          activatedAt: new Date(),
          pushToken: 'ExponentPushToken[v07-ok]',
        },
      });
    });

    it('envoie une fois au téléphone actif, puis plus rien', async () => {
      await notifyV07('QUOTA_CHANGED', { href: null });
      expect(await dispatcher.dispatch()).toBe(1);
      expect(provider.sent).toEqual([
        expect.objectContaining({
          to: 'ExponentPushToken[v07-ok]',
          title: 'Titre push',
          body: 'Corps push',
        }),
      ]);
      expect(await dispatcher.dispatch()).toBe(0);
      expect(provider.sent).toHaveLength(1);
    });

    it('appareil révoqué : plus de push, sauf celui qui annonce la révocation', async () => {
      await raw.device.update({ where: { id: deviceId }, data: { status: 'REVOKED' } });
      provider.sent.length = 0;
      await notifyV07('QUOTA_CHANGED');
      expect(await dispatcher.dispatch()).toBe(0);
      await notifyV07('DEVICE_REVOKED', { deviceId });
      expect(await dispatcher.dispatch()).toBe(1);
      expect(provider.sent[0]!.to).toBe('ExponentPushToken[v07-ok]');
      await raw.device.update({ where: { id: deviceId }, data: { status: 'ACTIVE' } });
    });

    it('jeton refusé par Expo : effacé', async () => {
      await raw.device.update({
        where: { id: deviceId },
        data: { pushToken: 'ExponentPushToken[dead]' },
      });
      provider.dead.add('ExponentPushToken[dead]');
      await notifyV07('QUOTA_CHANGED');
      await dispatcher.dispatch();
      const device = await raw.device.findUniqueOrThrow({ where: { id: deviceId } });
      expect(device.pushToken).toBeNull();
    });

    it('deux envoyeurs en même temps : un seul envoi', async () => {
      await raw.device.update({
        where: { id: deviceId },
        data: { pushToken: 'ExponentPushToken[v07-ok]' },
      });
      provider.sent.length = 0;
      await notifyV07('QUOTA_CHANGED');
      const [a, b] = await Promise.all([dispatcher.dispatch(), dispatcher.dispatch()]);
      expect(a + b).toBe(1);
      expect(provider.sent).toHaveLength(1);
    });
  });

  describe('événements BR-NOT (spec §2.4)', () => {
    const EV = '2027-06-26';
    let phones: Phones;
    let supB: string;
    let cptB: string;
    let products: ProductDto[];

    /** Dernière notification d'un type pour un utilisateur. */
    const last = (code: string, type: string, company = 'DISTRI-ORAN') =>
      raw.notification.findFirst({
        where: { type, user: { code, company: { code: company } } },
        orderBy: { createdAt: 'desc' },
      });
    const item = (reference: string, unitName: string) => {
      const product = products.find((p) => p.variants.some((v) => v.reference === reference))!;
      const unit = product.units.find((u) => u.name === unitName)!;
      return { variantId: product.variants.find((v) => v.reference === reference)!.id, unit };
    };

    beforeAll(async () => {
      supB = await webLogin(t.url, 'CASHVAN-EST', 'B-SUP');
      cptB = await webLogin(t.url, 'CASHVAN-EST', 'B-CPT');
      phones = new Phones(t, { 'DISTRI-ORAN': supA, 'CASHVAN-EST': supB });
      products = (
        await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: supA })
      ).body;
    });
    afterAll(async () => {
      // Client de test retiré : les autres suites comptent les clients à revoir
      await raw.customer.updateMany({
        where: { name: 'Kiosque Notif' },
        data: { deletedAt: new Date() },
      });
      await raw.order.updateMany({
        where: { orderDate: new Date(`${EV}T00:00:00Z`), status: { in: ['CONFIRMED', 'LOCKED'] } },
        data: { status: 'CANCELLED' },
      });
      await raw.visit.updateMany({
        where: { date: new Date(`${EV}T00:00:00Z`), status: 'IN_PROGRESS' },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });
      await raw.workday.updateMany({
        where: { date: new Date(`${EV}T00:00:00Z`), status: 'IN_PROGRESS' },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    });

    describe('pré-vendeur V08', () => {
      let p: Phone;
      let workdayId: string;
      let customers: { id: string; latitude: number | null; longitude: number | null }[];

      beforeAll(async () => {
        p = await phones.get('V08');
        workdayId = await phones.startDay(p, EV);
        customers = (await phones.today(p, EV)).body.day.customers;
      });

      it('quota modifié : le vendeur est prévenu, pas l’auteur', async () => {
        const thon = item('THON-TOM', 'carton');
        const reply = await call(t.url, 'PUT', '/quotas', {
          token: supA,
          body: {
            date: EV,
            entries: [
              {
                userId: ids['V08']!.id,
                productVariantId: thon.variantId,
                unitId: thon.unit.id,
                qty: 1,
              },
            ],
          },
        });
        expect(reply.status, JSON.stringify(reply.body)).toBe(200);
        expect(await last('V08', 'QUOTA_CHANGED')).toMatchObject({ title: 'Quota modifié' });
        expect(await last('A-SUP', 'QUOTA_CHANGED')).toBeNull();
      });

      it('lignes en attente : le superviseur est prévenu ; décision : le vendeur aussi', async () => {
        const thon = item('THON-TOM', 'carton');
        const visitId = await phones.startVisit(p, customers[0]!.id, 'PHONE');
        const result = await phones.send(p, 'order.confirm', {
          orderId: uuidv7(),
          number: `V08-${p.series}8801`,
          visitId,
          lines: [{ variantId: thon.variantId, unitId: thon.unit.id, qty: 3 }],
        });
        expect(result.status, JSON.stringify(result)).toMatch(/^APPLIED/);
        const notice = await last('A-SUP', 'PENDING_LINES');
        expect(notice).toMatchObject({
          title: 'Lignes en attente',
          data: { href: '/app/attente' },
        });
        expect(notice!.body).toContain(`V08-${p.series}8801`);
        expect(await last('V08', 'Test par droit')).toBeNull();

        const line = await raw.orderLine.findFirstOrThrow({
          where: { kind: 'PENDING', order: { number: `V08-${p.series}8801` } },
        });
        const decided = await call(t.url, 'POST', '/pending-lines/decide', {
          token: supA,
          body: { lineIds: [line.id], decision: 'REFUSE' },
        });
        expect(decided.status, JSON.stringify(decided.body)).toBeLessThan(300);
        expect(await last('V08', 'PENDING_DECIDED')).toMatchObject({
          title: 'Lignes en attente refusées',
        });
      });

      it('nouveau client créé sur le terrain', async () => {
        const type = await raw.customerType.findFirstOrThrow({
          where: { company: { code: 'DISTRI-ORAN' } },
        });
        const created = await phones.send(p, 'customer.create', {
          customerId: uuidv7(),
          name: 'Kiosque Notif',
          customerTypeId: type.id,
          latitude: 35.7,
          longitude: -0.63,
          frequency: 'WEEKLY',
        });
        expect(created.status, JSON.stringify(created)).toBe('APPLIED');
        const notice = await last('A-SUP', 'NEW_CUSTOMER');
        expect(notice).toMatchObject({ title: 'Nouveau client', data: { href: '/app/clients' } });
        expect(notice!.body).toContain('Kiosque Notif');
      });

      it('visite hors zone', async () => {
        const target = customers.find((c) => c.latitude !== null)!;
        const visitId = uuidv7();
        const started = await phones.send(p, 'visit.start', {
          visitId,
          customerId: target.id,
          mode: 'ON_SITE',
          latitude: 36.75,
          longitude: 3.05,
        });
        expect(started.status, JSON.stringify(started)).toBe('APPLIED');
        expect(await last('A-SUP', 'OUT_OF_ZONE_VISIT')).toMatchObject({
          title: 'Visite hors zone',
          data: { href: '/app/suivi' },
        });
        const reason = await raw.reason.findFirstOrThrow({
          where: { kind: 'NO_ORDER', company: { code: 'DISTRI-ORAN' } },
        });
        await phones.send(p, 'visit.close_no_order', { visitId, reasonId: reason.id });
      });

      it('clôture hors connexion, puis réouverture', async () => {
        const closed = await phones.send(p, 'workday.close', { workdayId, offline: true });
        expect(closed.status, JSON.stringify(closed)).toBe('APPLIED');
        expect(await last('A-SUP', 'WORKDAY_OFFLINE')).toMatchObject({
          title: 'Journée clôturée hors connexion',
          data: { href: '/app/journees' },
        });
        const reopened = await call(t.url, 'POST', `/workdays/${workdayId}/reopen`, {
          token: supA,
          body: { reason: 'Commande oubliée' },
        });
        expect(reopened.status, JSON.stringify(reopened.body)).toBeLessThan(300);
        const notice = await last('V08', 'WORKDAY_REOPENED');
        expect(notice).toMatchObject({ title: 'Journée rouverte' });
        expect(notice!.body).toContain('Commande oubliée');
      });
    });

    it('cash van : écarts de pointage, de déchargement et de versement', async () => {
      const c = await phones.get('C02', 'CASHVAN-EST');
      const user = await raw.user.findFirstOrThrow({
        where: { code: 'C02', company: { code: 'CASHVAN-EST' } },
      });
      await raw.load.updateMany({
        where: { userId: user.id, status: 'LOADED' },
        data: { status: 'RECEIVED' },
      });
      const workdayId = await phones.startDay(c, EV);
      const lines = (
        await call<TruckCheckLine[]>(t.url, 'GET', '/me/truck-check', { token: c.token })
      ).body;
      const short = lines.find((l) => l.inTruck > 0)!;
      expect(short, 'stock dans le camion').toBeTruthy();
      const checked = await phones.send(c, 'truck.check', {
        lines: lines.map((l) => ({
          variantId: l.variantId,
          countedQty: l.variantId === short.variantId ? l.inTruck - 1 : l.inTruck,
        })),
      });
      expect(checked.status, JSON.stringify(checked)).toBe('APPLIED');
      expect(await last('B-SUP', 'LOAD_GAP', 'CASHVAN-EST')).toMatchObject({
        title: 'Écart au chargement',
        data: { href: '/app/stock' },
      });

      await phones.closeDay(c, workdayId);
      const preview = (
        await call<UnloadPreviewLine[]>(t.url, 'GET', `/unloads/preview?workdayId=${workdayId}`, {
          token: supB,
        })
      ).body;
      const gapLine = preview.find((l) => l.theoretical > 0)!;
      const adjustment = await raw.reason.findFirstOrThrow({
        where: { kind: 'ADJUSTMENT', isActive: true, company: { code: 'CASHVAN-EST' } },
      });
      const unloaded = await call(t.url, 'POST', '/unloads', {
        token: supB,
        body: {
          workdayId,
          lines: preview.map((l) => ({
            variantId: l.variantId,
            countedQty: l.variantId === gapLine.variantId ? l.theoretical - 1 : l.theoretical,
            ...(l.variantId === gapLine.variantId ? { reasonId: adjustment.id } : {}),
          })),
        },
      });
      expect(unloaded.status, JSON.stringify(unloaded.body)).toBe(201);
      expect(await last('B-ADM', 'UNLOAD_GAP', 'CASHVAN-EST')).toMatchObject({
        title: 'Écart au déchargement',
        data: { href: '/app/ecarts' },
      });
      expect(await last('B-SUP', 'UNLOAD_GAP', 'CASHVAN-EST')).toBeNull();

      const settled = await call(t.url, 'POST', '/settlements', {
        token: cptB,
        body: { workdayId, remittedAmount: 100, note: 'Test notification' },
      });
      expect(settled.status, JSON.stringify(settled.body)).toBeLessThan(300);
      const notice = await last('B-SUP', 'SETTLEMENT_GAP', 'CASHVAN-EST');
      expect(notice).toMatchObject({
        title: 'Écart de versement',
        data: { href: '/app/versements' },
      });
      expect(await last('B-CPT', 'SETTLEMENT_GAP', 'CASHVAN-EST')).toBeNull();
    });

    it('appareil révoqué : une notification pour ce téléphone', async () => {
      const p = await phones.get('V07');
      const revoked = await call(t.url, 'POST', `/devices/${p.deviceId}/revoke`, { token: supA });
      expect(revoked.status, JSON.stringify(revoked.body)).toBeLessThan(300);
      const notice = await last('V07', 'DEVICE_REVOKED');
      expect(notice).toMatchObject({ title: 'Appareil révoqué', data: { deviceId: p.deviceId } });
    });
  });

  describe('téléphone (synchronisation)', () => {
    it('les notifications arrivent par la synchronisation ; « lu » par la file', async () => {
      const phones = new Phones(t, { 'DISTRI-ORAN': supA });
      const p = await phones.get('V08');
      await raw.$transaction((tx) =>
        notifications.notify(tx, {
          companyId: ids['V08']!.companyId,
          type: 'QUOTA_CHANGED',
          title: 'Quota modifié',
          body: 'Test synchronisation',
          to: { userIds: [ids['V08']!.id] },
        }),
      );
      // Réception complète, page par page
      const rows: SyncPullResponse['rows'] = [];
      const replace = new Set<string>();
      let page: string | null = null;
      do {
        const reply: { status: number; body: SyncPullResponse } = await call<SyncPullResponse>(
          t.url,
          'GET',
          `/sync/pull?cursor=0&date=2027-06-26${page ? `&page=${page}` : ''}`,
          { token: p.token },
        );
        expect(reply.status).toBe(200);
        rows.push(...reply.body.rows);
        reply.body.replace.forEach((k) => replace.add(k));
        page = reply.body.page;
      } while (page);
      const mine = rows.filter((r) => r.kind === 'notification');
      expect(mine.some((r) => (r.data as { body: string }).body === 'Test synchronisation')).toBe(
        true,
      );
      expect(replace.has('notification')).toBe(true);
      const own = mine.find(
        (r) => (r.data as { body: string }).body === 'Test synchronisation',
      )!.id;
      const other = await raw.notification.findFirstOrThrow({
        where: { userId: ids['A-SUP']!.id },
      });
      const read = await phones.send(p, 'notification.read', { notificationIds: [own, other.id] });
      expect(read).toMatchObject({ status: 'APPLIED', result: { read: 1 } });
      expect(
        (await raw.notification.findUniqueOrThrow({ where: { id: own } })).readAt,
      ).not.toBeNull();
      // Celle d'un autre n'est pas touchée
      expect(
        (await raw.notification.findUniqueOrThrow({ where: { id: other.id } })).readAt,
      ).toEqual(other.readAt);
    });
  });
});
