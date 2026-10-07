import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushDispatcher } from './push-dispatcher.service';
import { PUSH_PROVIDER, pushProviderFactory } from './push.provider';

/** Notifications internes et push (phase 24) : global, chaque domaine notifie ses événements. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    PushDispatcher,
    { provide: PUSH_PROVIDER, useFactory: pushProviderFactory },
  ],
  exports: [NotificationsService, PushDispatcher],
})
export class NotificationsModule {}
