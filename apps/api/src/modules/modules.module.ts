import { Global, Module } from '@nestjs/common';
import { PlatformCompaniesController } from '../platform/platform-companies.controller';
import { RolesService } from '../roles/roles.service';
import { ModulesController } from './modules.controller';
import { ModulesService } from './modules.service';

@Global()
@Module({
  controllers: [ModulesController, PlatformCompaniesController],
  providers: [ModulesService, RolesService],
  exports: [ModulesService, RolesService],
})
export class ModulesModule {}
