import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { SupervisionModule } from '../supervision/supervision.module';
import { AdvancesService } from './advances.service';
import { CompensationService } from './compensation.service';
import { DeductionsService } from './deductions.service';
import { IncentivesService } from './incentives.service';
import { PayrollAutomationService } from './payroll-automation.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

/** Paie interne : rémunérations, acomptes, retenues, primes, périodes de paie (phase 21 bis). */
@Module({
  imports: [FieldModule, SupervisionModule],
  controllers: [PayrollController],
  providers: [
    CompensationService,
    AdvancesService,
    DeductionsService,
    IncentivesService,
    PayrollService,
    PayrollAutomationService,
  ],
  exports: [PayrollAutomationService],
})
export class PayrollModule {}
