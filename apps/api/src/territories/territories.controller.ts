import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  assignCustomersSchema,
  createTerritorySchema,
  type CustomerPosition,
  type FieldPosition,
  type PartsChangeResult,
  type TerritoryDto,
  type TerritoryOverlap,
  territoryPartsSchema,
  territoryScheduleSchema,
  updateTerritorySchema,
} from '@sellwasl/validation';
import { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { Versioned } from '../common/versioning';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TerritoriesService } from './territories.service';

type Out<T extends z.ZodType> = z.output<T>;
const uuid = new ParseUUIDPipe();
const dryRunSchema = z.object({
  dryRun: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

/** Secteurs, parties, planning et carte (docs/api.md §5.3, docs/territories.md). */
@Controller()
export class TerritoriesController {
  constructor(private readonly territories: TerritoriesService) {}

  @RequirePermission('territories.read')
  @Get('territories')
  list(): Promise<TerritoryDto[]> {
    return this.territories.list();
  }

  @RequirePermission('territories.read')
  @Get('territories/overlaps')
  overlaps(): Promise<TerritoryOverlap[]> {
    return this.territories.overlaps();
  }

  @RequirePermission('territories.update')
  @Post('territories')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTerritorySchema)) body: Out<typeof createTerritorySchema>,
  ): Promise<TerritoryDto> {
    return this.territories.create(user, body);
  }

  @RequirePermission('territories.update')
  @Versioned('territory')
  @Patch('territories/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateTerritorySchema)) body: Out<typeof updateTerritorySchema>,
  ): Promise<TerritoryDto> {
    return this.territories.update(user, id, body);
  }

  @RequirePermission('territories.update')
  @Put('territories/:id/parts')
  setParts(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(dryRunSchema)) query: Out<typeof dryRunSchema>,
    @Body(new ZodValidationPipe(territoryPartsSchema)) body: Out<typeof territoryPartsSchema>,
  ): Promise<PartsChangeResult> {
    return this.territories.setParts(user, id, body, query.dryRun);
  }

  @RequirePermission('territories.update')
  @Put('territories/:id/schedule')
  setSchedule(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(territoryScheduleSchema)) body: Out<typeof territoryScheduleSchema>,
  ): Promise<TerritoryDto> {
    return this.territories.setSchedule(user, id, body);
  }

  @RequirePermission('territories.read')
  @Get('map/customers')
  customerPositions(): Promise<CustomerPosition[]> {
    return this.territories.customerPositions();
  }

  @RequirePermission('territories.read')
  @Get('map/field-users')
  fieldPositions(): Promise<FieldPosition[]> {
    return this.territories.fieldPositions();
  }

  @RequirePermission('customers.update')
  @Post('customers/assign-part')
  assign(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(assignCustomersSchema)) body: Out<typeof assignCustomersSchema>,
  ) {
    return this.territories.assignCustomers(user, body);
  }
}
