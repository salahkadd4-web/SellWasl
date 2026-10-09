import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { localDate } from '@sellwasl/business-rules';
import {
  type AdvanceDto,
  advancesQuerySchema,
  calculateIncentivesSchema,
  type CompensationDto,
  compensationQuerySchema,
  createAdjustmentSchema,
  createAdvanceSchema,
  createCompensationSchema,
  createDeductionSchema,
  createPayrollPeriodSchema,
  type CurrentCompensationDto,
  decisionNoteSchema,
  type DeductionDto,
  deductionsQuerySchema,
  type IncentiveDto,
  type IncentiveProgressDto,
  type IncentiveRuleDto,
  incentiveRuleSchema,
  incentivesQuerySchema,
  monthQuerySchema,
  type MyPayDto,
  type PayrollAdjustmentDto,
  type PayrollDashboardDto,
  type PayrollPeriodDto,
  type PayrollSettings,
  progressQuerySchema,
  putPayrollSettingsSchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { Idempotent } from '../common/idempotency';
import { Versioned } from '../common/versioning';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { AdvancesService } from './advances.service';
import { CompensationService } from './compensation.service';
import { DeductionsService } from './deductions.service';
import { IncentivesService } from './incentives.service';
import { PayrollService } from './payroll.service';

type Out<T extends z.ZodType> = z.output<T>;
const uuid = new ParseUUIDPipe();
const pipe = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema);

/** Rémunérations, acomptes, retenues, primes et paie (phase 21 bis). */
@Controller()
export class PayrollController {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly compensation: CompensationService,
    private readonly advances: AdvancesService,
    private readonly deductions: DeductionsService,
    private readonly incentives: IncentivesService,
    private readonly payroll: PayrollService,
  ) {}

  /** Mois en cours dans le fuseau de l'entreprise. */
  private async today(): Promise<string> {
    const company = await this.db.company.findFirstOrThrow();
    return localDate(new Date(), company.timezone);
  }

  // Rémunérations et paramètres

  @RequirePermission('compensation.read')
  @Get('compensations')
  compensations(
    @Query(pipe(compensationQuerySchema)) q: Out<typeof compensationQuerySchema>,
  ): Promise<CompensationDto[]> {
    return this.compensation.list(q.userId);
  }

  @RequirePermission('compensation.read')
  @Get('compensations/current')
  async current(): Promise<CurrentCompensationDto[]> {
    return this.compensation.current(await this.today());
  }

  @RequirePermission('compensation.update')
  @Post('compensations')
  createCompensation(
    @CurrentUser() actor: AuthUser,
    @Body(pipe(createCompensationSchema)) body: Out<typeof createCompensationSchema>,
  ): Promise<CompensationDto> {
    return this.compensation.create(actor, body);
  }

  @RequirePermission('payroll.read')
  @Get('payroll/settings')
  settings(): Promise<PayrollSettings> {
    return this.compensation.settings();
  }

  @RequirePermission('settings.update')
  @Put('payroll/settings')
  putSettings(
    @CurrentUser() actor: AuthUser,
    @Body(pipe(putPayrollSettingsSchema)) body: Out<typeof putPayrollSettingsSchema>,
  ): Promise<PayrollSettings> {
    return this.compensation.putSettings(actor, body);
  }

  // Acomptes

  @RequirePermission('advances.manage')
  @Get('advances')
  listAdvances(
    @Query(pipe(advancesQuerySchema)) q: Out<typeof advancesQuerySchema>,
  ): Promise<AdvanceDto[]> {
    return this.advances.list(q);
  }

  @RequirePermission('advances.manage')
  @Post('advances')
  createAdvance(
    @CurrentUser() actor: AuthUser,
    @Body(pipe(createAdvanceSchema)) body: Out<typeof createAdvanceSchema>,
  ): Promise<AdvanceDto> {
    return this.advances.create(actor, body);
  }

  @RequirePermission('advances.manage')
  @Post('advances/:id/approve')
  @HttpCode(200)
  approveAdvance(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<AdvanceDto> {
    return this.advances.approve(actor, id);
  }

  @RequirePermission('advances.manage')
  @Post('advances/:id/reject')
  @HttpCode(200)
  rejectAdvance(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
    @Body(pipe(decisionNoteSchema)) body: Out<typeof decisionNoteSchema>,
  ): Promise<AdvanceDto> {
    return this.advances.reject(actor, id, body.note);
  }

  @RequirePermission('advances.manage')
  @Idempotent()
  @Post('advances/:id/pay')
  @HttpCode(200)
  payAdvance(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string): Promise<AdvanceDto> {
    return this.advances.pay(actor, id);
  }

  // Retenues

  @RequirePermission('deductions.manage')
  @Get('deductions')
  listDeductions(
    @Query(pipe(deductionsQuerySchema)) q: Out<typeof deductionsQuerySchema>,
  ): Promise<DeductionDto[]> {
    return this.deductions.list(q);
  }

  @RequirePermission('deductions.manage')
  @Post('deductions')
  createDeduction(
    @CurrentUser() actor: AuthUser,
    @Body(pipe(createDeductionSchema)) body: Out<typeof createDeductionSchema>,
  ): Promise<DeductionDto> {
    return this.deductions.create(actor, body);
  }

  @RequirePermission('deductions.manage')
  @Post('deductions/:id/approve')
  @HttpCode(200)
  approveDeduction(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<DeductionDto> {
    return this.deductions.approve(actor, id);
  }

  @RequirePermission('deductions.manage')
  @Post('deductions/:id/reject')
  @HttpCode(200)
  rejectDeduction(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
    @Body(pipe(decisionNoteSchema)) body: Out<typeof decisionNoteSchema>,
  ): Promise<DeductionDto> {
    return this.deductions.reject(actor, id, body.note);
  }

  // Primes

  @RequirePermission('incentives.read')
  @Get('incentive-rules')
  rules(): Promise<IncentiveRuleDto[]> {
    return this.incentives.rules();
  }

  @RequirePermission('incentives.manage')
  @Post('incentive-rules')
  createRule(
    @CurrentUser() actor: AuthUser,
    @Body(pipe(incentiveRuleSchema)) body: Out<typeof incentiveRuleSchema>,
  ): Promise<IncentiveRuleDto> {
    return this.incentives.createRule(actor, body);
  }

  @RequirePermission('incentives.manage')
  @Versioned('incentiveRule')
  @Patch('incentive-rules/:id')
  updateRule(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
    @Body(pipe(incentiveRuleSchema)) body: Out<typeof incentiveRuleSchema>,
  ): Promise<IncentiveRuleDto> {
    return this.incentives.updateRule(actor, id, body);
  }

  @RequirePermission('incentives.read')
  @Get('incentives')
  listIncentives(
    @Query(pipe(incentivesQuerySchema)) q: Out<typeof incentivesQuerySchema>,
  ): Promise<IncentiveDto[]> {
    return this.incentives.list(q);
  }

  @RequirePermission('incentives.validate')
  @Post('incentives/calculate')
  @HttpCode(200)
  calculateIncentives(
    @CurrentUser() actor: AuthUser,
    @Body(pipe(calculateIncentivesSchema)) body: Out<typeof calculateIncentivesSchema>,
  ): Promise<IncentiveDto[]> {
    return this.incentives.calculate(actor, body);
  }

  @RequirePermission('incentives.validate')
  @Post('incentives/:id/validate')
  @HttpCode(200)
  validateIncentive(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<IncentiveDto> {
    return this.incentives.validate(actor, id);
  }

  @RequirePermission('incentives.validate')
  @Post('incentives/:id/reject')
  @HttpCode(200)
  rejectIncentive(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<IncentiveDto> {
    return this.incentives.reject(actor, id);
  }

  // Paie

  @RequirePermission('payroll.read')
  @Get('payroll/periods')
  periods(): Promise<PayrollPeriodDto[]> {
    return this.payroll.periods();
  }

  @RequirePermission('payroll.manage')
  @Post('payroll/periods')
  createPeriod(
    @CurrentUser() actor: AuthUser,
    @Body(pipe(createPayrollPeriodSchema)) body: Out<typeof createPayrollPeriodSchema>,
  ): Promise<PayrollPeriodDto> {
    return this.payroll.create(actor, body.month);
  }

  @RequirePermission('payroll.read')
  @Get('payroll/periods/:id')
  period(@Param('id', uuid) id: string): Promise<PayrollPeriodDto> {
    return this.payroll.get(id);
  }

  @RequirePermission('payroll.manage')
  @Post('payroll/periods/:id/calculate')
  @HttpCode(200)
  calculate(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<PayrollPeriodDto> {
    return this.payroll.calculate(actor, id);
  }

  @RequirePermission('payroll.manage')
  @Post('payroll/periods/:id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<PayrollPeriodDto> {
    return this.payroll.approve(actor, id);
  }

  @RequirePermission('payroll.manage')
  @Post('payroll/periods/:id/close')
  @HttpCode(200)
  close(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string): Promise<PayrollPeriodDto> {
    return this.payroll.close(actor, id);
  }

  @RequirePermission('payroll.manage')
  @Idempotent()
  @Post('payroll/payments/:id/pay')
  @HttpCode(200)
  pay(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string): Promise<PayrollPeriodDto> {
    return this.payroll.pay(actor, id);
  }

  @RequirePermission('payroll.manage')
  @Get('payroll/adjustments')
  adjustments(
    @Query(pipe(monthQuerySchema)) q: Out<typeof monthQuerySchema>,
  ): Promise<PayrollAdjustmentDto[]> {
    return this.payroll.adjustments(q.month);
  }

  @RequirePermission('payroll.manage')
  @Post('payroll/adjustments')
  createAdjustment(
    @CurrentUser() actor: AuthUser,
    @Body(pipe(createAdjustmentSchema)) body: Out<typeof createAdjustmentSchema>,
  ): Promise<PayrollAdjustmentDto> {
    return this.payroll.createAdjustment(actor, body);
  }

  @RequirePermission('payroll.read')
  @Get('payroll/dashboard')
  async dashboard(
    @Query(pipe(monthQuerySchema)) q: Out<typeof monthQuerySchema>,
  ): Promise<PayrollDashboardDto> {
    return this.payroll.dashboard(q.month ?? (await this.today()).slice(0, 7));
  }

  @RequirePermission('pay.mine')
  @Get('me/incentives/progress')
  async progress(
    @CurrentUser() actor: AuthUser,
    @Query(pipe(progressQuerySchema)) q: Out<typeof progressQuerySchema>,
  ): Promise<IncentiveProgressDto[]> {
    return this.incentives.progress(actor, q.date ?? (await this.today()));
  }

  @RequirePermission('pay.mine')
  @Get('me/pay')
  async mine(
    @CurrentUser() actor: AuthUser,
    @Query(pipe(monthQuerySchema)) q: Out<typeof monthQuerySchema>,
  ): Promise<MyPayDto> {
    return this.payroll.mine(actor, q.month ?? (await this.today()).slice(0, 7));
  }
}
