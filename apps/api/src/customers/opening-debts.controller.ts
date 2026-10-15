import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { openingDebtSchema, type OpeningDebtState } from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OpeningDebtService } from './opening-debt.service';

/** Soldes d'ouverture des dettes (BR-PAY-09, docs/api.md). */
@Controller()
export class OpeningDebtsController {
  constructor(private readonly openingDebts: OpeningDebtService) {}

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
}
