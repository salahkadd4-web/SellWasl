import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  type CommercialReportDto,
  type DashboardDto,
  dashboardQuerySchema,
  type DeliveryReportDto,
  type LostSalesReportDto,
  mapQuerySchema,
  type PresalesReportDto,
  reportsQuerySchema,
  type SupervisorMapDto,
  type TodayRowDto,
  type UserSheetDto,
  userSheetQuerySchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LiveService } from './live.service';
import { ReportsService } from './reports.service';

type Out<T extends z.ZodType> = z.output<T>;
const reportsQuery = new ZodValidationPipe(reportsQuerySchema);

/** Dashboard, suivi du jour, carte, fiches et rapports (module ANALYTICS, phase 21). */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly live: LiveService,
  ) {}

  @RequirePermission('reports.read')
  @Get('dashboard')
  dashboard(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(dashboardQuerySchema)) q: Out<typeof dashboardQuerySchema>,
  ): Promise<DashboardDto> {
    return this.reports.dashboard(actor, q);
  }

  @RequirePermission('reports.read')
  @Get('today')
  today(): Promise<TodayRowDto[]> {
    return this.live.today();
  }

  @RequirePermission('reports.read')
  @Get('map')
  map(
    @Query(new ZodValidationPipe(mapQuerySchema)) q: Out<typeof mapQuerySchema>,
  ): Promise<SupervisorMapDto> {
    return this.live.map(q.date);
  }

  @RequirePermission('reports.read')
  @Get('users/:id')
  user(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(userSheetQuerySchema)) q: Out<typeof userSheetQuerySchema>,
  ): Promise<UserSheetDto> {
    return this.reports.userSheet(actor, id, q);
  }

  @RequirePermission('reports.read')
  @Get('commercial')
  commercial(@Query(reportsQuery) q: Out<typeof reportsQuerySchema>): Promise<CommercialReportDto> {
    return this.reports.commercial(q);
  }

  @RequirePermission('reports.read')
  @Get('presales')
  presales(@Query(reportsQuery) q: Out<typeof reportsQuerySchema>): Promise<PresalesReportDto> {
    return this.reports.presales(q);
  }

  @RequirePermission('reports.read')
  @Get('delivery')
  delivery(@Query(reportsQuery) q: Out<typeof reportsQuerySchema>): Promise<DeliveryReportDto> {
    return this.reports.delivery(q);
  }

  @RequirePermission('reports.read')
  @Get('lost-sales')
  lostSales(@Query(reportsQuery) q: Out<typeof reportsQuerySchema>): Promise<LostSalesReportDto> {
    return this.reports.lostSales(q);
  }
}
