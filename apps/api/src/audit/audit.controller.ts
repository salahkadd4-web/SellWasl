import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  type AuditFilters,
  auditFiltersSchema,
  auditQuerySchema,
  type AuditRowDto,
  type Page,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuditQueryService } from './audit-query.service';

/** Journal d'audit de l'entreprise (BR-AUD-01, docs/audit.md) : consultation par l'admin. */
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @RequirePermission('audit.read')
  @Get()
  list(
    @Query(new ZodValidationPipe(auditQuerySchema)) q: z.output<typeof auditQuerySchema>,
  ): Promise<Page<AuditRowDto>> {
    return this.audit.list(q);
  }

  @RequirePermission('audit.read')
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="journal-audit.csv"')
  export(@Query(new ZodValidationPipe(auditFiltersSchema)) q: AuditFilters): Promise<string> {
    return this.audit.csv(q);
  }
}
