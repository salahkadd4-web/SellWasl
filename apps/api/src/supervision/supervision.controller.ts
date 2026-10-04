import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  decidePendingSchema,
  type OrderDto,
  ordersQuerySchema,
  type PendingLineDto,
  pendingLinesQuerySchema,
  type ObjectiveDto,
  objectiveCapSchema,
  objectivesQuerySchema,
  putObjectivesSchema,
  putQuotasSchema,
  type QuotaDto,
  quotasQuerySchema,
  type WorkdayDto,
  workdayReasonSchema,
  workdaysQuerySchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { notFound } from '../common/api-error';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { toDate } from '../field/field-errors';
import { OrderService } from '../field/order.service';
import { ObjectivesAdminService } from './objectives-admin.service';
import { PendingLinesService } from './pending-lines.service';
import { QuotasService } from './quotas.service';
import { WorkdaysAdminService } from './workdays-admin.service';

type Out<T extends z.ZodType> = z.output<T>;

/** Sur le téléphone, un vendeur ne consulte que ses propres commandes (BR-SYN-04). */
const ownOnPhone = (actor: AuthUser): { sellerUserId?: string } =>
  actor.channel === 'MOBILE' ? { sellerUserId: actor.userId } : {};

/** Écrans Web du superviseur pour la prévente (phase 16, docs/api.md §5.4). */
@Controller()
export class SupervisionController {
  constructor(
    private readonly quotas: QuotasService,
    private readonly objectives: ObjectivesAdminService,
    private readonly pending: PendingLinesService,
    private readonly orders: OrderService,
    private readonly workdays: WorkdaysAdminService,
  ) {}

  @RequirePermission('workdays.read')
  @Get('workdays')
  listWorkdays(
    @Query(new ZodValidationPipe(workdaysQuerySchema)) query: Out<typeof workdaysQuerySchema>,
  ): Promise<WorkdayDto[]> {
    return this.workdays.list(query.date);
  }

  @RequirePermission('workdays.reopen')
  @Post('workdays/:id/reopen')
  @HttpCode(200)
  reopen(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(workdayReasonSchema)) body: Out<typeof workdayReasonSchema>,
  ): Promise<{ workdayId: string }> {
    return this.workdays.reopen(actor, id, body.reason);
  }

  @RequirePermission('workdays.force_close')
  @Post('workdays/:id/force-close')
  @HttpCode(200)
  forceClose(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(workdayReasonSchema)) body: Out<typeof workdayReasonSchema>,
  ): Promise<{ workdayId: string }> {
    return this.workdays.forceClose(actor, id, body.reason);
  }

  @RequirePermission('pending_lines.process')
  @Get('pending-lines')
  listPending(
    @Query(new ZodValidationPipe(pendingLinesQuerySchema))
    query: Out<typeof pendingLinesQuerySchema>,
  ): Promise<PendingLineDto[]> {
    return this.pending.list(query.date);
  }

  @RequirePermission('pending_lines.process')
  @Post('pending-lines/decide')
  @HttpCode(200)
  decide(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(decidePendingSchema)) body: Out<typeof decidePendingSchema>,
  ): Promise<{ processed: number }> {
    return this.pending.decide(actor, body.lineIds, body.decision);
  }

  @RequirePermission('orders.read')
  @Get('orders')
  listOrders(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(ordersQuerySchema)) query: Out<typeof ordersQuerySchema>,
  ): Promise<OrderDto[]> {
    return this.orders.toDtos({
      ...(query.date ? { orderDate: toDate(query.date) } : {}),
      ...(query.sellerId ? { sellerUserId: query.sellerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      // En dernier : aucun filtre de la requête ne peut l'élargir
      ...ownOnPhone(actor),
    });
  }

  @RequirePermission('orders.read')
  @Get('orders/:id')
  async order(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<OrderDto> {
    const [order] = await this.orders.toDtos({ id, ...ownOnPhone(actor) });
    if (!order) throw notFound('Commande introuvable.');
    return order;
  }

  @RequirePermission('quotas.read')
  @Get('quotas')
  listQuotas(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(quotasQuerySchema)) query: Out<typeof quotasQuerySchema>,
  ): Promise<QuotaDto[]> {
    return this.quotas.list(query.date, ownOnPhone(actor).sellerUserId);
  }

  @RequirePermission('quotas.update')
  @Put('quotas')
  putQuotas(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(putQuotasSchema)) body: Out<typeof putQuotasSchema>,
  ): Promise<QuotaDto[]> {
    return this.quotas.put(actor, body);
  }

  @RequirePermission('objectives.read')
  @Get('objectives')
  listObjectives(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(objectivesQuerySchema)) query: Out<typeof objectivesQuerySchema>,
  ): Promise<ObjectiveDto[]> {
    return this.objectives.list(query.month, ownOnPhone(actor).sellerUserId);
  }

  @RequirePermission('objectives.read')
  @Get('objectives/cap')
  async objectivesCap(): Promise<{ capPercent: number | null }> {
    return { capPercent: await this.objectives.cap() };
  }

  @RequirePermission('objectives.update')
  @Put('objectives/cap')
  putObjectivesCap(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(objectiveCapSchema)) body: Out<typeof objectiveCapSchema>,
  ): Promise<{ capPercent: number | null }> {
    return this.objectives.setCap(actor, body.capPercent);
  }

  @RequirePermission('objectives.update')
  @Put('objectives')
  putObjectives(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(putObjectivesSchema)) body: Out<typeof putObjectivesSchema>,
  ): Promise<ObjectiveDto[]> {
    return this.objectives.put(actor, body);
  }
}
