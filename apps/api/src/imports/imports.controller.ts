import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ImportPreview } from '@sellwasl/validation';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import {
  CUSTOMER_TEMPLATE,
  ImportsService,
  MAX_IMPORT_BYTES,
  type UploadedCsv,
} from './imports.service';

/** Import CSV des clients (docs/api.md §8.1). Les produits viendront avec la phase 12. */
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @RequirePermission('imports.run')
  @Get('templates/customers')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="modele-clients.csv"')
  template(): string {
    return CUSTOMER_TEMPLATE;
  }

  @RequirePermission('imports.run')
  @Post()
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedCsv | undefined,
  ): Promise<ImportPreview> {
    return this.imports.preview(user, file);
  }

  @RequirePermission('imports.run')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ImportPreview> {
    return this.imports.get(id);
  }

  @RequirePermission('imports.run')
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ImportPreview> {
    return this.imports.confirm(user, id);
  }
}
