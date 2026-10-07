import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  type NotificationDto,
  type NotificationListQuery,
  notificationListQuerySchema,
  type Page,
} from '@sellwasl/validation';
import { AnyAuthenticated, type AuthUser, CurrentUser } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

/** Notifications de l'utilisateur connecté (docs/api.md, BR-NOT-01) : chacun voit les siennes. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @AnyAuthenticated()
  @Get()
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(notificationListQuerySchema)) query: NotificationListQuery,
  ): Promise<Page<NotificationDto>> {
    return this.notifications.list(actor, query);
  }

  @AnyAuthenticated()
  @Get('unread-count')
  unreadCount(@CurrentUser() actor: AuthUser): Promise<{ count: number }> {
    return this.notifications.unreadCount(actor);
  }

  @AnyAuthenticated()
  @Post('read-all')
  @HttpCode(204)
  readAll(@CurrentUser() actor: AuthUser): Promise<void> {
    return this.notifications.readAll(actor);
  }

  @AnyAuthenticated()
  @Patch(':id/read')
  read(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationDto> {
    return this.notifications.read(actor, id);
  }
}
