-- CreateEnum
CREATE TYPE "DiscrepancyKind" AS ENUM ('STOCK', 'FINANCIAL');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('VALIDATED', 'UNDER_REVIEW', 'REJECTED', 'RESOLVED', 'DEDUCTION_PENDING', 'DEDUCTION_APPROVED', 'DEDUCTION_APPLIED');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'DEDUCTED');

-- CreateEnum
CREATE TYPE "DeductionSource" AS ENUM ('STOCK_DISCREPANCY', 'FINANCIAL_DISCREPANCY', 'OTHER');

-- CreateEnum
CREATE TYPE "DeductionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED');

-- CreateEnum
CREATE TYPE "IncentiveKind" AS ENUM ('PER_UNIT', 'PERCENT_REVENUE', 'THRESHOLD', 'TIERED', 'REVENUE_TARGET');

-- CreateEnum
CREATE TYPE "IncentiveFrequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "IncentiveStatus" AS ENUM ('CALCULATED', 'VALIDATED', 'REJECTED', 'APPLIED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('OPEN', 'CALCULATED', 'APPROVED', 'PAID', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayrollLineKind" AS ENUM ('BASE_SALARY', 'INCENTIVE', 'OBJECTIVE_BONUS', 'DRIVER_BONUS', 'ADJUSTMENT', 'ADVANCE', 'DEDUCTION');

-- AlterTable
ALTER TABLE "settlement" ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "discrepancy" (
    "id" UUID NOT NULL,
    "kind" "DiscrepancyKind" NOT NULL,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'VALIDATED',
    "date" DATE NOT NULL,
    "qty" INTEGER,
    "unit_value" BIGINT,
    "amount" BIGINT NOT NULL,
    "cause" TEXT,
    "decision_note" TEXT,
    "validated_by_user_id" UUID NOT NULL,
    "validated_at" TIMESTAMPTZ(3) NOT NULL,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workday_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "unload_line_id" UUID,
    "settlement_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_compensation" (
    "id" UUID NOT NULL,
    "base_salary" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "note" TEXT,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_compensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_advance" (
    "id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "paid_by_user_id" UUID,
    "paid_at" TIMESTAMPTZ(3),
    "deducted_at" TIMESTAMPTZ(3),
    "payroll_period_id" UUID,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "salary_advance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_deduction" (
    "id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "source_type" "DeductionSource" NOT NULL,
    "month" DATE,
    "status" "DeductionStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "applied_at" TIMESTAMPTZ(3),
    "payroll_period_id" UUID,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "discrepancy_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_deduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_rule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "IncentiveKind" NOT NULL,
    "frequency" "IncentiveFrequency" NOT NULL,
    "amount" BIGINT,
    "percent_bp" INTEGER,
    "threshold" BIGINT,
    "tiers" JSONB,
    "role_code" "RoleCode",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "unit_id" UUID,
    "company_id" UUID NOT NULL,
    "product_id" UUID,
    "user_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incentive_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive" (
    "id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "revenue" BIGINT NOT NULL DEFAULT 0,
    "unit_amount" BIGINT,
    "amount" BIGINT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '[]',
    "status" "IncentiveStatus" NOT NULL DEFAULT 'CALCULATED',
    "validated_by_user_id" UUID,
    "validated_at" TIMESTAMPTZ(3),
    "applied_at" TIMESTAMPTZ(3),
    "payroll_period_id" UUID,
    "company_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incentive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_period" (
    "id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'OPEN',
    "calculated_at" TIMESTAMPTZ(3),
    "calculated_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_user_id" UUID,
    "paid_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_user_id" UUID,
    "company_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_entry" (
    "id" UUID NOT NULL,
    "base_salary" BIGINT NOT NULL,
    "earnings" BIGINT NOT NULL DEFAULT 0,
    "advances" BIGINT NOT NULL DEFAULT 0,
    "deductions" BIGINT NOT NULL DEFAULT 0,
    "net" BIGINT NOT NULL,
    "company_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_line" (
    "id" UUID NOT NULL,
    "kind" "PayrollLineKind" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "source_type" TEXT,
    "source_id" UUID,
    "company_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_payment" (
    "id" UUID NOT NULL,
    "installment" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "percent" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "paid_by_user_id" UUID,
    "company_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustment" (
    "id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "payroll_period_id" UUID,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discrepancy_unload_line_id_key" ON "discrepancy"("unload_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "discrepancy_settlement_id_key" ON "discrepancy"("settlement_id");

-- CreateIndex
CREATE INDEX "discrepancy_company_id_status_idx" ON "discrepancy"("company_id", "status");

-- CreateIndex
CREATE INDEX "discrepancy_company_id_change_seq_idx" ON "discrepancy"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "employee_compensation_company_id_change_seq_idx" ON "employee_compensation"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "employee_compensation_company_id_user_id_effective_from_key" ON "employee_compensation"("company_id", "user_id", "effective_from");

-- CreateIndex
CREATE INDEX "salary_advance_company_id_month_idx" ON "salary_advance"("company_id", "month");

-- CreateIndex
CREATE INDEX "salary_advance_company_id_change_seq_idx" ON "salary_advance"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_deduction_discrepancy_id_key" ON "payroll_deduction"("discrepancy_id");

-- CreateIndex
CREATE INDEX "payroll_deduction_company_id_status_idx" ON "payroll_deduction"("company_id", "status");

-- CreateIndex
CREATE INDEX "payroll_deduction_company_id_change_seq_idx" ON "payroll_deduction"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "incentive_rule_company_id_change_seq_idx" ON "incentive_rule"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "incentive_company_id_change_seq_idx" ON "incentive"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "incentive_rule_id_user_id_period_start_key" ON "incentive"("rule_id", "user_id", "period_start");

-- CreateIndex
CREATE INDEX "payroll_period_company_id_change_seq_idx" ON "payroll_period"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_period_company_id_month_key" ON "payroll_period"("company_id", "month");

-- CreateIndex
CREATE INDEX "payroll_entry_company_id_change_seq_idx" ON "payroll_entry"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_entry_period_id_user_id_key" ON "payroll_entry"("period_id", "user_id");

-- CreateIndex
CREATE INDEX "payroll_line_company_id_change_seq_idx" ON "payroll_line"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "payroll_payment_company_id_change_seq_idx" ON "payroll_payment"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_payment_entry_id_installment_key" ON "payroll_payment"("entry_id", "installment");

-- CreateIndex
CREATE INDEX "payroll_adjustment_company_id_month_idx" ON "payroll_adjustment"("company_id", "month");

-- CreateIndex
CREATE INDEX "payroll_adjustment_company_id_change_seq_idx" ON "payroll_adjustment"("company_id", "change_seq");

-- AddForeignKey
ALTER TABLE "discrepancy" ADD CONSTRAINT "discrepancy_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancy" ADD CONSTRAINT "discrepancy_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancy" ADD CONSTRAINT "discrepancy_unload_line_id_fkey" FOREIGN KEY ("unload_line_id") REFERENCES "unload_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancy" ADD CONSTRAINT "discrepancy_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_compensation" ADD CONSTRAINT "employee_compensation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_compensation" ADD CONSTRAINT "employee_compensation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_advance" ADD CONSTRAINT "salary_advance_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_advance" ADD CONSTRAINT "salary_advance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_deduction" ADD CONSTRAINT "payroll_deduction_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_deduction" ADD CONSTRAINT "payroll_deduction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_deduction" ADD CONSTRAINT "payroll_deduction_discrepancy_id_fkey" FOREIGN KEY ("discrepancy_id") REFERENCES "discrepancy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_rule" ADD CONSTRAINT "incentive_rule_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_rule" ADD CONSTRAINT "incentive_rule_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_rule" ADD CONSTRAINT "incentive_rule_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive" ADD CONSTRAINT "incentive_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive" ADD CONSTRAINT "incentive_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "incentive_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive" ADD CONSTRAINT "incentive_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_period" ADD CONSTRAINT "payroll_period_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entry" ADD CONSTRAINT "payroll_entry_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entry" ADD CONSTRAINT "payroll_entry_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "payroll_period"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entry" ADD CONSTRAINT "payroll_entry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "payroll_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payment" ADD CONSTRAINT "payroll_payment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payment" ADD CONSTRAINT "payroll_payment_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "payroll_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustment" ADD CONSTRAINT "payroll_adjustment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustment" ADD CONSTRAINT "payroll_adjustment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Synchronisation (tables [S])
CREATE TRIGGER discrepancy_sync_change BEFORE INSERT OR UPDATE ON "discrepancy" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER employee_compensation_sync_change BEFORE INSERT OR UPDATE ON "employee_compensation" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER salary_advance_sync_change BEFORE INSERT OR UPDATE ON "salary_advance" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER payroll_deduction_sync_change BEFORE INSERT OR UPDATE ON "payroll_deduction" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER incentive_rule_sync_change BEFORE INSERT OR UPDATE ON "incentive_rule" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER incentive_sync_change BEFORE INSERT OR UPDATE ON "incentive" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER payroll_period_sync_change BEFORE INSERT OR UPDATE ON "payroll_period" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER payroll_entry_sync_change BEFORE INSERT OR UPDATE ON "payroll_entry" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER payroll_line_sync_change BEFORE INSERT OR UPDATE ON "payroll_line" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER payroll_payment_sync_change BEFORE INSERT OR UPDATE ON "payroll_payment" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER payroll_adjustment_sync_change BEFORE INSERT OR UPDATE ON "payroll_adjustment" FOR EACH ROW EXECUTE FUNCTION sync_row_change();

-- Montants : jamais négatifs là où la règle l'interdit
ALTER TABLE "employee_compensation" ADD CONSTRAINT employee_compensation_salary_check CHECK (base_salary >= 0);
ALTER TABLE "employee_compensation" ADD CONSTRAINT employee_compensation_period_check CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE "salary_advance" ADD CONSTRAINT salary_advance_amount_check CHECK (amount > 0);
ALTER TABLE "payroll_deduction" ADD CONSTRAINT payroll_deduction_amount_check CHECK (amount > 0);
ALTER TABLE "incentive" ADD CONSTRAINT incentive_amount_check CHECK (amount >= 0 AND quantity >= 0);
ALTER TABLE "payroll_payment" ADD CONSTRAINT payroll_payment_amount_check CHECK (amount >= 0 AND percent BETWEEN 1 AND 100);
ALTER TABLE "payroll_adjustment" ADD CONSTRAINT payroll_adjustment_amount_check CHECK (amount <> 0);

-- Droits de la paie (phase 21 bis)
INSERT INTO "permission" ("code", "description", "scope") VALUES
  ('compensation.read', 'Consulter les rémunérations et leur historique', 'COMPANY'),
  ('compensation.update', 'Fixer la rémunération des employés', 'COMPANY'),
  ('payroll.read', 'Consulter les paies', 'COMPANY'),
  ('payroll.manage', 'Calculer, approuver, payer et clôturer les paies', 'COMPANY'),
  ('advances.manage', 'Gérer les acomptes', 'COMPANY'),
  ('deductions.manage', 'Créer, approuver ou refuser les retenues', 'COMPANY'),
  ('incentives.read', 'Consulter les règles de prime et les primes', 'COMPANY'),
  ('incentives.manage', 'Configurer les règles de prime', 'COMPANY'),
  ('incentives.validate', 'Calculer et valider les primes', 'COMPANY'),
  ('discrepancies.read', 'Consulter les écarts de stock et de caisse', 'COMPANY'),
  ('discrepancies.decide', 'Analyser les écarts et décider de la responsabilité', 'COMPANY'),
  ('pay.mine', 'Consulter sa propre rémunération, ses primes, acomptes, retenues et paies', 'COMPANY')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permission" ("role_id", "permission_code")
SELECT r.id, p.code FROM "role" r
JOIN (VALUES
  ('COMPANY_ADMIN', 'discrepancies.read'), ('COMPANY_ADMIN', 'incentives.read'), ('COMPANY_ADMIN', 'pay.mine'),
  ('COMPANY_ADMIN', 'compensation.read'), ('COMPANY_ADMIN', 'compensation.update'), ('COMPANY_ADMIN', 'payroll.read'),
  ('COMPANY_ADMIN', 'incentives.manage'),
  ('SUPERVISEUR', 'discrepancies.read'), ('SUPERVISEUR', 'incentives.read'), ('SUPERVISEUR', 'pay.mine'),
  ('COMPTABLE', 'compensation.read'), ('COMPTABLE', 'payroll.read'), ('COMPTABLE', 'payroll.manage'),
  ('COMPTABLE', 'advances.manage'), ('COMPTABLE', 'deductions.manage'), ('COMPTABLE', 'incentives.read'),
  ('COMPTABLE', 'incentives.validate'), ('COMPTABLE', 'discrepancies.read'), ('COMPTABLE', 'discrepancies.decide'),
  ('COMPTABLE', 'pay.mine'),
  ('PRE_VENDEUR', 'pay.mine'), ('VENDEUR_CASH_VAN', 'pay.mine'), ('LIVREUR', 'pay.mine'), ('MAGASINIER', 'pay.mine')
) AS p(role, code) ON r.code::text = p.role
ON CONFLICT DO NOTHING;
