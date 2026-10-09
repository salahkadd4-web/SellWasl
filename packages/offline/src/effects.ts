import { distanceMeters, missedCustomers } from '@sellwasl/business-rules';
import type { CustomerDto, OfflineOrder, OfflineVisit } from '@sellwasl/validation';
import { cloneState, type LocalState, meOf as me, openWorkday } from './local-state';
import { buildOrder } from './order-build';
import type { OutboxOp } from './types';

import { type Effect, num, str } from './effect-kit';
import { DRIVER_EFFECTS } from './effects-driver';
import { TRUCK_EFFECTS } from './effects-truck';

/** Effet local de chaque opération du terrain (spec phase 23 §4.4). */
export const EFFECTS: Partial<Record<OutboxOp['type'], Effect>> = {
  ...TRUCK_EFFECTS,
  ...DRIVER_EFFECTS,
  'workday.start': (s, p, op) => {
    const id = str(p.workdayId)!;
    if (s.workdays.some((w) => w.id === id)) return;
    s.workdays.push({
      id,
      date: str(p.date)!,
      status: 'IN_PROGRESS',
      startedAt: op.occurredAt,
      closedAt: null,
    });
  },

  // Clôture : commandes figées, clients du jour non visités marqués manqués (BR-JOU-07)
  'workday.close': (s, p, op) => {
    const workday = s.workdays.find((w) => w.id === str(p.workdayId));
    if (!workday || workday.status !== 'IN_PROGRESS') return;
    workday.status = 'CLOSED';
    workday.closedAt = op.occurredAt;
    for (const o of s.orders.values())
      if (o.workdayId === workday.id && o.status === 'CONFIRMED') o.status = 'LOCKED';
    const day = s.planning.get(workday.date);
    const known = s.visits
      .filter((v) => v.date === workday.date && (v.status === 'COMPLETED' || v.status === 'MISSED'))
      .map((v) => v.customerId);
    const missed = missedCustomers(
      (day?.customers ?? []).map((c) => ({ customerId: c.id, reason: c.reason })),
      known,
    );
    for (const customerId of missed)
      s.visits.push({
        id: `missed-${workday.id}-${customerId}`,
        customerId,
        status: 'MISSED',
        mode: 'ON_SITE',
        isScheduled: true,
        isOutOfZone: false,
        distanceM: null,
        startedAt: null,
        endedAt: null,
        date: workday.date,
      });
  },

  // Visite : prévue ou hors programme, distance et hors zone comme le serveur (BR-VIS-02)
  'visit.start': (s, p, op) => {
    const workday = openWorkday(s);
    const customer = s.customers.get(str(p.customerId) ?? '');
    if (!workday || !customer || s.visits.some((v) => v.id === str(p.visitId))) return;
    const onSite = p.mode === 'ON_SITE';
    const lat = num(p.latitude);
    const lng = num(p.longitude);
    const phone = lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null;
    const position =
      customer.latitude !== null && customer.longitude !== null
        ? { latitude: customer.latitude, longitude: customer.longitude }
        : null;
    const distanceM =
      onSite && phone && position ? Math.round(distanceMeters(phone, position)) : null;
    const limit = s.settings?.rules.outOfZoneDistanceM ?? Number.POSITIVE_INFINITY;
    const visit: OfflineVisit = {
      id: str(p.visitId)!,
      customerId: customer.id,
      status: 'IN_PROGRESS',
      mode: onSite ? 'ON_SITE' : 'PHONE',
      isScheduled: !!s.planning.get(workday.date)?.customers.some((c) => c.id === customer.id),
      isOutOfZone: onSite && (distanceM === null ? position !== null : distanceM > limit),
      distanceM,
      startedAt: op.occurredAt,
      endedAt: null,
      date: workday.date,
    };
    s.visits.push(visit);
  },

  'visit.close_no_order': (s, p, op) => {
    const visit = s.visits.find((v) => v.id === str(p.visitId));
    if (!visit || visit.status !== 'IN_PROGRESS') return;
    visit.status = 'COMPLETED';
    visit.endedAt = op.occurredAt;
  },

  // Client créé sur le terrain : nouveau, à placer par le serveur (BR-CLI-05)
  'customer.create': (s, p, op) => {
    const id = str(p.customerId)!;
    if (s.customers.has(id)) return;
    const territory = s.territories[0] ?? null;
    const typeId = str(p.customerTypeId)!;
    const type = territory?.customerTypes.find((t) => t.id === typeId);
    const customer: CustomerDto = {
      id,
      code: null,
      name: str(p.name) ?? '',
      phone: str(p.phone),
      address: str(p.address),
      latitude: num(p.latitude),
      longitude: num(p.longitude),
      customerType: { id: typeId, code: '', name: type?.name ?? '' },
      territory: territory
        ? { id: territory.id, code: territory.code, name: territory.name }
        : null,
      part: null,
      isPartForced: false,
      frequency: p.frequency as CustomerDto['frequency'],
      referenceDate: null,
      isCreditAllowed: false,
      creditLimitAmount: 0,
      debtAmount: 0,
      status: 'ACTIVE',
      isNew: true,
      isCashOnly: false,
      isClosedPermanently: false,
      reviewReasons: ['NEW', 'OUT_OF_PART'],
      createdBy: me(s).name,
      createdAt: op.occurredAt,
      // Fiche neuve : la réception du serveur apportera sa version
      version: 1,
    };
    s.customers.set(id, customer);
  },

  // Commande : prix, quota et réservation calculés comme le serveur ; elle termine la visite
  'order.confirm': (s, p, op) => {
    const id = str(p.orderId)!;
    const visit = s.visits.find((v) => v.id === str(p.visitId));
    const customer = visit ? s.customers.get(visit.customerId) : undefined;
    if (!visit || !customer || s.orders.has(id)) return;
    const built = buildOrder(s, {
      customerTypeId: customer.customerType.id,
      date: visit.date,
      lines: p.lines as never,
      freeVariantChoices: p.freeVariantChoices as Record<string, string> | undefined,
      cashVan: false,
    });
    const order: OfflineOrder = {
      id,
      number: str(p.number) ?? '',
      status: 'CONFIRMED',
      source: visit.mode === 'PHONE' ? 'PHONE' : 'PRE_SALES',
      orderDate: visit.date,
      deliveryDate: null,
      totalAmount: built.totalAmount,
      visitId: visit.id,
      customer: { id: customer.id, name: customer.name, code: customer.code },
      seller: me(s),
      confirmedAt: op.occurredAt,
      lines: built.lines,
      workdayId: op.workdayId ?? openWorkday(s)?.id ?? null,
      customerTypeId: customer.customerType.id,
    };
    s.orders.set(id, order);
    visit.status = 'COMPLETED';
    visit.endedAt = op.occurredAt;
  },

  'order.update': (s, p) => {
    const order = s.orders.get(str(p.orderId) ?? '');
    if (!order || order.status !== 'CONFIRMED') return;
    const built = buildOrder(s, {
      customerTypeId: order.customerTypeId,
      date: order.orderDate,
      lines: p.lines as never,
      freeVariantChoices: p.freeVariantChoices as Record<string, string> | undefined,
      excludeOrderId: order.id,
      cashVan: false,
    });
    order.lines = built.lines;
    order.totalAmount = built.totalAmount;
  },

  'order.cancel': (s, p) => {
    const order = s.orders.get(str(p.orderId) ?? '');
    if (order && order.status === 'CONFIRMED') order.status = 'CANCELLED';
  },

  // Notification lue sur le téléphone, même hors connexion (phase 24)
  'notification.read': (s, p, op) => {
    const ids = new Set((p.notificationIds as string[] | undefined) ?? []);
    for (const n of s.notifications) if (ids.has(n.id) && !n.readAt) n.readAt = op.occurredAt;
  },

  // Encaissement de dette : la dette du client baisse (BR-PAY-04)
  'payment.debt': (s, p, op) => {
    const id = str(p.paymentId)!;
    const amount = num(p.amount) ?? 0;
    const customer = s.customers.get(str(p.customerId) ?? '');
    const workday = openWorkday(s);
    if (s.payments.some((x) => x.id === id) || !customer || !workday) return;
    s.payments.push({
      id,
      number: str(p.number) ?? '',
      kind: 'DEBT_PAYMENT',
      at: op.occurredAt,
      workdayId: workday.id,
      customerId: customer.id,
      orderId: null,
      dueAmount: amount,
      cashAmount: amount,
      creditAmount: 0,
    });
    customer.debtAmount = Math.max(0, customer.debtAmount - amount);
  },
};

/**
 * Vue locale = données reçues + effet des opérations en file (spec phase 23 §4.4). Une opération
 * refusée (CONFLICT) ou déjà reflétée par une réception n'a pas d'effet ; une opération dont
 * l'effet est impossible avec les données du téléphone est ignorée (le serveur tranchera).
 */
export function applyOps(state: LocalState, ops: OutboxOp[]): LocalState {
  const s = cloneState(state);
  for (const op of [...ops].sort((a, b) => a.deviceSeq - b.deviceSeq)) {
    if (op.status === 'CONFLICT' || op.reflected) continue;
    const effect = EFFECTS[op.type];
    if (!effect) continue;
    try {
      effect(s, op.payload, op);
    } catch {
      // Données locales insuffisantes (grille absente…) : pas d'effet affiché
    }
  }
  return s;
}
