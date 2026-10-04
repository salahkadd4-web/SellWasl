import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { paymentDebtPayload } from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import type { Prisma } from '../generated/prisma/client';
import { SyncHandlers } from '../sync/sync.handlers';
import { rule } from './field-errors';
import { VisitService } from './visit.service';
import { WorkdayService } from './workday.service';

type DebtPayload = z.output<typeof paymentDebtPayload>;

/** Encaissement d'une dette par le vendeur (UC-19, BR-PAY-04, BR-PAY-05). */
@Injectable()
export class DebtService implements OnModuleInit {
  constructor(
    private readonly workdays: WorkdayService,
    private readonly visits: VisitService,
    private readonly audit: AuditService,
    private readonly handlers: SyncHandlers,
  ) {}

  onModuleInit(): void {
    this.handlers.register('payment.debt', 'payments.collect_debt', paymentDebtPayload, (ctx) =>
      this.collect(ctx.actor, ctx.tx, ctx.payload, new Date(ctx.op.occurredAt)),
    );
  }

  private async collect(
    actor: AuthUser,
    tx: Prisma.TransactionClient,
    payload: DebtPayload,
    occurredAt: Date,
  ) {
    const workday = await this.workdays.openWorkday(tx, actor);
    const customer = await this.visits.sectorCustomer(tx, actor, payload.customerId);
    const debt = Number(customer.debtAmount);
    // En ligne, la dette est connue : pas d'avance client (BR-PAY-04)
    if (payload.amount > debt)
      throw rule(`Le montant dépasse la dette du client (${debt} DA).`, { rule: 'BR-PAY-05' });
    const taken = await tx.payment.findFirst({ where: { number: payload.number } });
    if (taken)
      throw new ApiError(
        HttpStatus.CONFLICT,
        'DUPLICATE',
        `Le reçu ${payload.number} existe déjà.`,
      );

    const amount = BigInt(payload.amount);
    await tx.payment.create({
      data: {
        id: payload.paymentId,
        companyId: actor.companyId,
        number: payload.number,
        kind: 'DEBT_PAYMENT',
        dueAmount: amount,
        cashAmount: amount,
        customerId: customer.id,
        userId: actor.userId,
        workdayId: workday.id,
        createdByUserId: actor.userId,
        createdByDeviceId: actor.deviceId,
        occurredAt,
      },
    });
    await tx.customerDebtEntry.create({
      data: {
        id: uuidv7(),
        companyId: actor.companyId,
        customerId: customer.id,
        kind: 'DEBT_PAYMENT',
        amount: -amount,
        occurredAt,
        paymentId: payload.paymentId,
      },
    });
    const updated = await tx.customer.update({
      where: { id: customer.id },
      data: { debtAmount: { decrement: amount }, version: { increment: 1 } },
    });
    await this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        deviceId: actor.deviceId,
        action: 'payment.debt',
        entity: 'Payment',
        entityId: payload.paymentId,
        after: { customerId: customer.id, amount: payload.amount, number: payload.number },
      },
      tx,
    );
    return {
      paymentId: payload.paymentId,
      number: payload.number,
      debtAmount: Number(updated.debtAmount),
    };
  }
}
