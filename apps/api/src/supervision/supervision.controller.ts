import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import {
  type ObjectiveDto,
  objectivesQuerySchema,
  putObjectivesSchema,
  putQuotasSchema,
  type QuotaDto,
  quotasQuerySchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ObjectivesAdminService } from './objectives-admin.service';
import { QuotasService } from './quotas.service';

type Out<T extends z.ZodType> = z.output<T>;

/** Écrans Web du superviseur pour la prévente (phase 16, docs/api.md §5.4). */
@Controller()
export class SupervisionController {
  constructor(
    private readonly quotas: QuotasService,
    private readonly objectives: ObjectivesAdminService,
  ) {}

  @RequirePermission('quotas.read')
  @Get('quotas')
  listQuotas(
    @Query(new ZodValidationPipe(quotasQuerySchema)) query: Out<typeof quotasQuerySchema>,
  ): Promise<QuotaDto[]> {
    return this.quotas.list(query.date);
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
    @Query(new ZodValidationPipe(objectivesQuerySchema)) query: Out<typeof objectivesQuerySchema>,
  ): Promise<ObjectiveDto[]> {
    return this.objectives.list(query.month);
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
