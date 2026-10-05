import { Controller, Get, Query } from '@nestjs/common';
import {
  myOrdersQuerySchema,
  type MyObjective,
  myObjectivesQuerySchema,
  myTodayQuerySchema,
  type OrderDto,
  type TodayResponse,
  type VisitCatalog,
} from '@sellwasl/validation';
import { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ObjectivesService } from './objectives.service';
import { OrderService } from './order.service';
import { VisitCatalogService } from './visit-catalog.service';
import { WorkdayService } from './workday.service';

const visitCatalogQuery = z.object({
  customerId: z.uuid(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Lectures du vendeur connecté sur son téléphone (phases 15 et 16). */
@Controller('me')
export class MeController {
  constructor(
    private readonly workdays: WorkdayService,
    private readonly objectives: ObjectivesService,
    private readonly orders: OrderService,
    private readonly visitCatalog: VisitCatalogService,
  ) {}

  // Catalogue de la visite : commande en prévente, vente en cash van (BR-CV-03)
  @RequirePermission('visits.own')
  @Get('visit-catalog')
  catalog(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(visitCatalogQuery)) query: z.output<typeof visitCatalogQuery>,
  ): Promise<VisitCatalog> {
    return this.visitCatalog.forCustomer(actor, query.customerId, query.date);
  }

  @RequirePermission('orders.own')
  @Get('orders')
  myOrders(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(myOrdersQuerySchema)) query: z.output<typeof myOrdersQuerySchema>,
  ): Promise<OrderDto[]> {
    return this.orders.toDtos({
      sellerUserId: actor.userId,
      orderDate: new Date(`${query.date}T00:00:00Z`),
    });
  }

  @RequirePermission('workdays.own')
  @Get('today')
  today(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(myTodayQuerySchema)) query: z.output<typeof myTodayQuerySchema>,
  ): Promise<TodayResponse> {
    return this.workdays.today(actor, query.date);
  }

  @RequirePermission('objectives.read')
  @Get('objectives')
  myObjectives(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(myObjectivesQuerySchema))
    query: z.output<typeof myObjectivesQuerySchema>,
  ): Promise<MyObjective[]> {
    return this.objectives.mine(actor, query.month);
  }
}
