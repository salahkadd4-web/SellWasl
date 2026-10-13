import { Module } from '@nestjs/common';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SupervisorPermissionsController } from './supervisor-permissions.controller';
import { SupervisorPermissionsService } from './supervisor-permissions.service';

/** Administration de l'entreprise : utilisateurs, paramétrage et permissions du superviseur. */
@Module({
  controllers: [UsersController, SettingsController, SupervisorPermissionsController],
  providers: [UsersService, SettingsService, SupervisorPermissionsService],
})
export class AdminModule {}
