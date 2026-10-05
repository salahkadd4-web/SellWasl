import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  type DeliveryPreviewDto,
  deliveryPreviewSchema,
  type DriverRouteDto,
  type TruckStockDto,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DeliveryService } from './delivery.service';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { DriverRouteService } from './driver-route.service';

/** Lectures du livreur sur son téléphone (phase 19). */
@Controller('me')
export class DeliveryController {
  constructor(
    private readonly driverRoute: DriverRouteService,
    private readonly deliveries: DeliveryService,
  ) {}

  @RequirePermission('deliveries.own')
  @Get('route')
  route(@CurrentUser() actor: AuthUser): Promise<DriverRouteDto> {
    return this.driverRoute.route(actor);
  }

  @RequirePermission('deliveries.own')
  @Get('truck-stock')
  truckStock(@CurrentUser() actor: AuthUser): Promise<TruckStockDto[]> {
    return this.driverRoute.truckStock(actor);
  }

  @RequirePermission('deliveries.own')
  @Post('deliveries/preview')
  @HttpCode(200)
  preview(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(deliveryPreviewSchema))
    body: z.output<typeof deliveryPreviewSchema>,
  ): Promise<DeliveryPreviewDto> {
    return this.deliveries.preview(actor, body);
  }
}
