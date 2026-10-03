import { Global, Module } from '@nestjs/common';
import { ProvisioningService } from '../companies/provisioning.service';
import { PlatformCompaniesController } from '../platform/platform-companies.controller';
import { RolesService } from '../roles/roles.service';
import { ModulesController } from './modules.controller';
import { ModulesService } from './modules.service';

@Global()
@Module({
  controllers: [ModulesController, PlatformCompaniesController],
  providers: [ModulesService, RolesService, ProvisioningService],
  exports: [ModulesService, RolesService],
})
export class ModulesModule {}
