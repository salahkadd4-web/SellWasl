import { Inject, Injectable } from '@nestjs/common';
import type { exportQuerySchema, ExportType, ReturnFactKindCode } from '@sellwasl/validation';
import type { z } from 'zod';
import { MAX_EXPORT_ROWS, toCsv } from '../common/csv';
import { dateOnly, toDate } from '../field/field-errors';
import { CONDITION_LABEL, ReturnsService } from '../returns/returns.service';
import { fullName } from '../stock/stock-helpers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Query = z.output<typeof exportQuerySchema>;

const STATUS: Record<string, string> = {
  CONFIRMED: 'Confirmée',
  LOCKED: 'Figée',
  PREPARING: 'En préparation',
  READY: 'Prête',
  OUT_FOR_DELIVERY: 'En livraison',
  DELIVERED: 'Livrée',
  PARTIALLY_DELIVERED: 'Livrée en partie',
  FAILED: 'Échec',
};
const VISIT: Record<string, string> = {
  PLANNED: 'Prévue',
  IN_PROGRESS: 'En cours',
  COMPLETED: 'Faite',
  MISSED: 'Manquée',
};
const OUTCOME: Record<string, string> = {
  ORDER: 'Commande',
  SALE: 'Vente',
  NO_ORDER: 'Sans commande',
};
const FACT_KIND: Record<
  Exclude<ExportType, 'sales' | 'visits' | 'objectives' | 'debts' | 'settlements'>,
  ReturnFactKindCode
> = {
  refusals: 'REFUSAL',
  returns: 'RETURN',
  resales: 'RESALE',
  gaps: 'GAP',
};
const frDay = (d: Date) => dateOnly(d).split('-').reverse().join('/');

/** Exports CSV (BR-IO-03) : ventes, visites, objectifs, dettes, versements et retours. */
@Injectable()
export class ExportsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly returns: ReturnsService,
  ) {}

  async csv(type: ExportType, q: Query): Promise<string> {
    const period = { gte: toDate(q.from), lte: toDate(q.to) };
    const customerFilter = {
      ...(q.territoryId && { territoryId: q.territoryId }),
      ...(q.partId && { partId: q.partId }),
    };
    switch (type) {
      case 'sales': {
        const orders = await this.db.order.findMany({
          where: {
            deletedAt: null,
            status: { notIn: ['DRAFT', 'CANCELLED'] },
            orderDate: period,
            ...(q.userId && { sellerUserId: q.userId }),
            ...(q.customerId && { customerId: q.customerId }),
            ...(q.productId && { orderLines: { some: { productId: q.productId } } }),
            customer: customerFilter,
          },
          include: { sellerUser: true, customer: { include: { territory: true } } },
          orderBy: [{ orderDate: 'asc' }, { number: 'asc' }],
          take: MAX_EXPORT_ROWS,
        });
        return toCsv(
          ['Numéro', 'Date', 'Statut', 'Origine', 'Vendeur', 'Client', 'Secteur', 'Montant'],
          orders.map((o) => [
            o.number,
            frDay(o.orderDate),
            STATUS[o.status] ?? o.status,
            o.source === 'CASH_VAN' ? 'Cash van' : 'Prévente',
            fullName(o.sellerUser),
            o.customer.name,
            o.customer.territory?.name ?? '',
            Number(o.totalAmount),
          ]),
        );
      }
      case 'visits': {
        const visits = await this.db.visit.findMany({
          where: {
            deletedAt: null,
            date: period,
            ...(q.userId && { userId: q.userId }),
            ...(q.customerId && { customerId: q.customerId }),
            customer: customerFilter,
          },
          include: { user: true, customer: true, reason: true },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
          take: MAX_EXPORT_ROWS,
        });
        return toCsv(
          [
            'Date',
            'Vendeur',
            'Client',
            'Statut',
            'Mode',
            'Résultat',
            'Motif',
            'Hors zone',
            'Programme',
          ],
          visits.map((v) => [
            frDay(v.date),
            fullName(v.user),
            v.customer.name,
            VISIT[v.status] ?? v.status,
            v.mode === 'PHONE' ? 'Téléphone' : 'Sur place',
            v.outcome ? OUTCOME[v.outcome] : '',
            v.reason?.label ?? '',
            v.isOutOfZone ? 'Oui' : 'Non',
            v.isScheduled ? 'Oui' : 'Non',
          ]),
        );
      }
      case 'objectives': {
        const start = new Date(Date.UTC(period.gte.getUTCFullYear(), period.gte.getUTCMonth(), 1));
        const objectives = await this.db.objective.findMany({
          where: {
            deletedAt: null,
            month: { gte: start, lte: period.lte },
            ...(q.userId && { userId: q.userId }),
          },
          include: { user: true, range: true },
          orderBy: [{ month: 'asc' }],
        });
        return toCsv(
          ['Mois', 'Vendeur', 'Gamme', 'Objectif', 'Prime'],
          objectives.map((o) => [
            dateOnly(o.month).slice(0, 7),
            fullName(o.user),
            o.range.name,
            Number(o.targetAmount),
            Number(o.bonusAmount),
          ]),
        );
      }
      case 'debts': {
        const customers = await this.db.customer.findMany({
          where: {
            deletedAt: null,
            debtAmount: { gt: 0 },
            ...customerFilter,
            ...(q.customerId && { id: q.customerId }),
          },
          include: { territory: true },
          orderBy: { debtAmount: 'desc' },
          take: MAX_EXPORT_ROWS,
        });
        return toCsv(
          ['Code', 'Client', 'Secteur', 'Dette', 'Crédit autorisé', 'Plafond'],
          customers.map((c) => [
            c.code ?? '',
            c.name,
            c.territory?.name ?? '',
            Number(c.debtAmount),
            c.isCreditAllowed ? 'Oui' : 'Non',
            Number(c.creditLimitAmount),
          ]),
        );
      }
      case 'settlements': {
        const settlements = await this.db.settlement.findMany({
          where: {
            workday: { date: period, ...(q.userId && { userId: q.userId }) },
          },
          include: { workday: { include: { user: true } }, accountantUser: true },
          orderBy: { validatedAt: 'asc' },
          take: MAX_EXPORT_ROWS,
        });
        return toCsv(
          ['Date', 'Agent', 'Attendu', 'Remis', 'Écart', 'Comptable', 'Validé le'],
          settlements.map((s) => [
            frDay(s.workday.date),
            fullName(s.workday.user),
            Number(s.expectedAmount),
            Number(s.remittedAmount),
            Number(s.gapAmount),
            fullName(s.accountantUser),
            s.validatedAt.toISOString(),
          ]),
        );
      }
      default: {
        const facts = await this.returns.list({ ...q, kind: FACT_KIND[type] }, MAX_EXPORT_ROWS);
        return toCsv(
          [
            'Date',
            'Article',
            'Quantité',
            'Valeur',
            'État',
            'Lot',
            'Fournisseur',
            'Pré-vendeur',
            'Livreur',
            'Client',
            'Secteur',
            'Motif',
            'Commande',
            'Bon de livraison',
          ],
          facts
            .reverse()
            .map((f) => [
              f.date.split('-').reverse().join('/'),
              f.article,
              f.qty,
              f.value,
              f.condition ? CONDITION_LABEL[f.condition] : '',
              f.lot,
              f.supplier,
              f.seller,
              f.driver,
              f.customer,
              f.territory,
              f.reason,
              f.order?.number,
              f.delivery?.number,
            ]),
        );
      }
    }
  }
}
