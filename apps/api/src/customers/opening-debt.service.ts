import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { OpeningDebtState } from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Tx = Prisma.TransactionClient;

export const FROZEN_MESSAGE =
  'Solde figé : le client a déjà des opérations de dette dans SellWasl.';

/**
 * Solde d'ouverture des dettes (BR-PAY-09) : saisi par montant cible, en ajout seul — une
 * correction ajoute l'écart. Modifiable tant que le client n'a aucune autre écriture de dette.
 */
@Injectable()
export class OpeningDebtService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  /** Solde d'ouverture et possibilité de le modifier, pour chaque client demandé. */
  async editableByCustomer(
    customerIds: string[],
    client: Pick<Tx, 'customerDebtEntry'> = this.db as unknown as Tx,
  ): Promise<Map<string, { opening: number; editable: boolean }>> {
    const groups = await client.customerDebtEntry.groupBy({
      by: ['customerId', 'kind'],
      where: { customerId: { in: customerIds } },
      _sum: { amount: true },
    });
    const result = new Map(customerIds.map((id) => [id, { opening: 0, editable: true }]));
    for (const g of groups) {
      const state = result.get(g.customerId)!;
      if (g.kind === 'OPENING_BALANCE') state.opening = Number(g._sum.amount ?? 0n);
      else state.editable = false;
    }
    return result;
  }

  async get(customerId: string): Promise<OpeningDebtState> {
    const customer = await this.db.customer.findFirst({
      where: { id: customerId, deletedAt: null },
    });
    if (!customer) throw notFound('Client introuvable.');
    const state = (await this.editableByCustomer([customerId])).get(customerId)!;
    return {
      openingDebtAmount: state.opening,
      openingDebtEditable: state.editable,
      debtAmount: Number(customer.debtAmount),
    };
  }

  /** Inscrit le solde `target` dans `tx`, sans audit : l'appelant audite. */
  async set(tx: Tx, actor: AuthUser, customerId: string, target: number) {
    const customer = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
    if (!customer) throw notFound('Client introuvable.');
    // Une vente à crédit synchronisée en même temps attend la fin de cette transaction
    await tx.$queryRaw`SELECT id FROM customer WHERE id = ${customerId}::uuid FOR UPDATE`;
    const state = (await this.editableByCustomer([customerId], tx)).get(customerId)!;
    if (!state.editable) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_RULE', FROZEN_MESSAGE, {
        rule: 'BR-PAY-09',
      });
    }
    const delta = target - state.opening;
    let debt = customer.debtAmount;
    if (delta !== 0) {
      await tx.customerDebtEntry.create({
        data: {
          id: uuidv7(),
          companyId: actor.companyId,
          customerId,
          kind: 'OPENING_BALANCE',
          amount: BigInt(delta),
          occurredAt: new Date(),
        },
      });
      debt = (
        await tx.customer.update({
          where: { id: customerId },
          data: { debtAmount: { increment: BigInt(delta) }, version: { increment: 1 } },
        })
      ).debtAmount;
    }
    return {
      before: state.opening,
      changed: delta !== 0,
      state: {
        openingDebtAmount: target,
        openingDebtEditable: true,
        debtAmount: Number(debt),
      } satisfies OpeningDebtState,
    };
  }

  /** Saisie sur la fiche client, auditée. */
  async update(actor: AuthUser, customerId: string, amount: number): Promise<OpeningDebtState> {
    return this.db.$transaction(async (tx) => {
      const result = await this.set(tx as unknown as Tx, actor, customerId, amount);
      if (result.changed) {
        await this.audit.write(
          {
            companyId: actor.companyId,
            actorUserId: actor.userId,
            action: 'debt.opening',
            entity: 'Customer',
            entityId: customerId,
            before: { openingDebtAmount: result.before },
            after: { openingDebtAmount: amount },
          },
          tx,
        );
      }
      return result.state;
    });
  }
}
