import {
  Body,
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
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import {
  CUSTOMER_TEMPLATE,
  ImportsService,
  MAX_IMPORT_BYTES,
  type UploadedCsv,
} from './imports.service';
import { ProductImportService } from './product-import.service';

const kindSchema = z.object({ kind: z.enum(['CUSTOMERS', 'PRODUCTS']).default('CUSTOMERS') });

/** Import CSV des clients et des produits (docs/api.md §8.1). */
@Controller('imports')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly products: ProductImportService,
  ) {}

  @RequirePermission('imports.run')
  @Get('templates/customers')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="modele-clients.csv"')
  customerTemplate(): string {
    return CUSTOMER_TEMPLATE;
  }

  @RequirePermission('imports.run')
  @Get('templates/products')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="modele-produits.csv"')
  productTemplate(): Promise<string> {
    return this.products.template();
  }

  /** Champ `kind` du formulaire : CUSTOMERS (par défaut) ou PRODUCTS. */
  @RequirePermission('imports.run')
  @Post()
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedCsv | undefined,
    @Body(new ZodValidationPipe(kindSchema)) body: z.output<typeof kindSchema>,
  ): Promise<ImportPreview> {
    return this.imports.preview(user, body.kind, file);
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
