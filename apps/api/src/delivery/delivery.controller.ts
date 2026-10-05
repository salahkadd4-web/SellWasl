import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  type DeliveryPreviewDto,
  deliveryPreviewSchema,
  type DriverRouteDto,
  type TruckCheckLine,
  type TruckStockDto,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DeliveryService } from './delivery.service';
import { DriverRouteService } from './driver-route.service';
import { LoadReceiveService } from './load-receive.service';

/** Lectures du livreur et du vendeur cash van sur leur téléphone (phases 19 et 20). */
@Controller('me')
export class DeliveryController {
  constructor(
    private readonly driverRoute: DriverRouteService,
    private readonly deliveries: DeliveryService,
    private readonly receipts: LoadReceiveService,
  ) {}

  @RequirePermission('deliveries.own')
  @Get('route')
  route(@CurrentUser() actor: AuthUser): Promise<DriverRouteDto> {
    return this.driverRoute.route(actor);
  }

  /** Stock du camion, consultable à tout moment (livreur, vendeur cash van). */
  @RequirePermission('stock.read')
  @Get('truck-stock')
  truckStock(@CurrentUser() actor: AuthUser): Promise<TruckStockDto[]> {
    return this.driverRoute.truckStock(actor);
  }

  /** Pointage du camion : lignes à compter. */
  @RequirePermission('loads.receive')
  @Get('truck-check')
  truckCheck(@CurrentUser() actor: AuthUser): Promise<TruckCheckLine[]> {
    return this.receipts.checkLines(actor);
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
