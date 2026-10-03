import { Module } from '@nestjs/common';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/** Administration de l'entreprise : utilisateurs et paramétrage (phase 9). */
@Module({
  controllers: [UsersController, SettingsController],
  providers: [UsersService, SettingsService],
})
export class AdminModule {}
