import { Controller, Get } from '@nestjs/common';
import type { DriverRouteDto, TruckStockDto } from '@sellwasl/validation';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { DriverRouteService } from './driver-route.service';

/** Lectures du livreur sur son téléphone (phase 19). */
@Controller('me')
export class DeliveryController {
  constructor(private readonly driverRoute: DriverRouteService) {}

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
}
