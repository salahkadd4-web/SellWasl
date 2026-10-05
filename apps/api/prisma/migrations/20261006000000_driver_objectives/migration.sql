-- CreateTable
CREATE TABLE "driver_objective" (
    "id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "bonus_amount" BIGINT NOT NULL DEFAULT 0,
    "ratings" JSONB NOT NULL DEFAULT '{}',
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "driver_objective_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "driver_objective_company_id_change_seq_idx" ON "driver_objective"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "driver_objective_company_id_user_id_month_key" ON "driver_objective"("company_id", "user_id", "month");

-- AddForeignKey
ALTER TABLE "driver_objective" ADD CONSTRAINT "driver_objective_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_objective" ADD CONSTRAINT "driver_objective_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER driver_objective_sync_change BEFORE INSERT OR UPDATE ON "driver_objective" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
ALTER TABLE "driver_objective" ADD CONSTRAINT driver_objective_bonus_check CHECK (bonus_amount >= 0);
