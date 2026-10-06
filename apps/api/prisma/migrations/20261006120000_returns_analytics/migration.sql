-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('RESTOCK', 'DEFECTIVE', 'EXPIRED', 'BROKEN');

-- CreateEnum
CREATE TYPE "ReturnFactKind" AS ENUM ('REFUSAL', 'RESALE', 'RETURN', 'GAP');

-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('NONE', 'CONTESTED', 'UPHELD', 'REJECTED');

-- AlterEnum
ALTER TYPE "ModuleCode" ADD VALUE 'RETURNS_ANALYSIS';

-- AlterEnum
ALTER TYPE "ReasonKind" ADD VALUE 'REFUSAL';

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'WRITE_OFF';

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "supplier_id" UUID;

-- AlterTable
ALTER TABLE "order_line" ADD COLUMN     "added_qty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock_receipt" ADD COLUMN     "supplier_id" UUID;

-- AlterTable
ALTER TABLE "stock_receipt_line" ADD COLUMN     "expires_at" DATE,
ADD COLUMN     "lot_id" UUID,
ADD COLUMN     "lot_number" TEXT;

-- AlterTable
ALTER TABLE "delivery" ADD COLUMN     "contest_comment" TEXT,
ADD COLUMN     "contest_decided_at" TIMESTAMPTZ(3),
ADD COLUMN     "contest_decided_by_user_id" UUID,
ADD COLUMN     "contest_status" "ContestStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "contested_at" TIMESTAMPTZ(3),
ADD COLUMN     "refusal_reason_id" UUID;

-- CreateTable
CREATE TABLE "supplier" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "expires_at" DATE,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "company_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "supplier_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unload_line_condition" (
    "id" UUID NOT NULL,
    "condition" "ReturnCondition" NOT NULL,
    "qty" INTEGER NOT NULL,
    "photo_key" TEXT,
    "company_id" UUID NOT NULL,
    "unload_line_id" UUID NOT NULL,
    "lot_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "unload_line_condition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_fact" (
    "id" UUID NOT NULL,
    "kind" "ReturnFactKind" NOT NULL,
    "date" DATE NOT NULL,
    "qty" INTEGER NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "condition" "ReturnCondition",
    "company_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_id" UUID,
    "supplier_id" UUID,
    "seller_user_id" UUID,
    "driver_user_id" UUID,
    "customer_id" UUID,
    "territory_id" UUID,
    "part_id" UUID,
    "route_id" UUID,
    "order_id" UUID,
    "delivery_id" UUID,
    "unload_id" UUID,
    "reason_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_fact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_company_id_change_seq_idx" ON "supplier"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_company_id_name_key" ON "supplier"("company_id", "name");

-- CreateIndex
CREATE INDEX "lot_company_id_change_seq_idx" ON "lot"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "lot_company_id_product_variant_id_number_key" ON "lot"("company_id", "product_variant_id", "number");

-- CreateIndex
CREATE INDEX "unload_line_condition_company_id_idx" ON "unload_line_condition"("company_id");

-- CreateIndex
CREATE INDEX "unload_line_condition_company_id_change_seq_idx" ON "unload_line_condition"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "return_fact_company_id_kind_date_idx" ON "return_fact"("company_id", "kind", "date");

-- CreateIndex
CREATE INDEX "return_fact_company_id_delivery_id_idx" ON "return_fact"("company_id", "delivery_id");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_refusal_reason_id_fkey" FOREIGN KEY ("refusal_reason_id") REFERENCES "reason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unload_line_condition" ADD CONSTRAINT "unload_line_condition_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unload_line_condition" ADD CONSTRAINT "unload_line_condition_unload_line_id_fkey" FOREIGN KEY ("unload_line_id") REFERENCES "unload_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unload_line_condition" ADD CONSTRAINT "unload_line_condition_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_fact" ADD CONSTRAINT "return_fact_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Synchronisation (comme les autres tables [S])
CREATE TRIGGER supplier_sync_change BEFORE INSERT OR UPDATE ON "supplier" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER lot_sync_change BEFORE INSERT OR UPDATE ON "lot" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER unload_line_condition_sync_change BEFORE INSERT OR UPDATE ON "unload_line_condition" FOR EACH ROW EXECUTE FUNCTION sync_row_change();

-- Quantités jamais négatives
ALTER TABLE "lot" ADD CONSTRAINT lot_received_qty_check CHECK (received_qty >= 0);
ALTER TABLE "unload_line_condition" ADD CONSTRAINT unload_line_condition_qty_check CHECK (qty > 0);
ALTER TABLE "order_line" ADD CONSTRAINT order_line_added_qty_check CHECK (added_qty >= 0);
ALTER TABLE "return_fact" ADD CONSTRAINT return_fact_value_check CHECK (value >= 0);
