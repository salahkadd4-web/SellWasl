import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import {
  EXPORT_TYPES,
  type ExportType,
  exportQuerySchema,
  RETURNS_EXPORTS,
} from '@sellwasl/validation';
import type { Response } from 'express';
import { z } from 'zod';
import { moduleDisabled } from '../auth/auth.guard';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ExportsService } from './exports.service';

const typeParam = new ZodValidationPipe(z.enum(EXPORT_TYPES));

/** Exports CSV (BR-IO-03, phase 21). */
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @RequirePermission('reports.export')
  @Get(':type')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async csv(
    @CurrentUser() actor: AuthUser,
    @Param('type', typeParam) type: ExportType,
    @Query(new ZodValidationPipe(exportQuerySchema)) q: z.output<typeof exportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    // Les exports des retours exigent aussi le module d'analyse des retours
    if (RETURNS_EXPORTS.includes(type) && !actor.modules.includes('RETURNS_ANALYSIS'))
      throw moduleDisabled();
    res.setHeader('Content-Disposition', `attachment; filename="${type}-${q.from}-${q.to}.csv"`);
    return this.exports.csv(type, q);
  }
}
