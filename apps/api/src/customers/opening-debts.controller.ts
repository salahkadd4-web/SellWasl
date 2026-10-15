import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type ImportPreview, openingDebtSchema, type OpeningDebtState } from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ImportsService, MAX_IMPORT_BYTES, type UploadedCsv } from '../imports/imports.service';
import { OPENING_DEBT_TEMPLATE } from '../imports/opening-debt-import.service';
import { OpeningDebtService } from './opening-debt.service';

const OPENING_DEBTS = ['OPENING_DEBTS'] as const;

/** Soldes d'ouverture des dettes : fiche client et import CSV (BR-PAY-09, docs/api.md). */
@Controller()
export class OpeningDebtsController {
  constructor(
    private readonly openingDebts: OpeningDebtService,
    private readonly imports: ImportsService,
  ) {}

  @RequirePermission('debts.opening')
  @Get('customers/:id/opening-debt')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<OpeningDebtState> {
    return this.openingDebts.get(id);
  }

  @RequirePermission('debts.opening')
  @Put('customers/:id/opening-debt')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(openingDebtSchema)) body: z.output<typeof openingDebtSchema>,
  ): Promise<OpeningDebtState> {
    return this.openingDebts.update(user, id, body.amount);
  }

  @RequirePermission('debts.opening')
  @Get('opening-debts/template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="modele-soldes.csv"')
  template(): string {
    return OPENING_DEBT_TEMPLATE;
  }

  @RequirePermission('debts.opening')
  @Post('opening-debts/imports')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedCsv | undefined,
  ): Promise<ImportPreview> {
    return this.imports.preview(user, 'OPENING_DEBTS', file);
  }

  @RequirePermission('debts.opening')
  @Get('opening-debts/imports/:id')
  getImport(@Param('id', ParseUUIDPipe) id: string): Promise<ImportPreview> {
    return this.imports.get(id, OPENING_DEBTS);
  }

  @RequirePermission('debts.opening')
  @Post('opening-debts/imports/:id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ImportPreview> {
    return this.imports.confirm(user, id, OPENING_DEBTS);
  }
}
