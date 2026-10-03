-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ModuleCode" AS ENUM ('PRE_SALES', 'DELIVERY', 'CASH_VAN', 'WAREHOUSE', 'ANALYTICS');

-- CreateEnum
CREATE TYPE "ModuleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('COMPANY_ADMIN', 'SUPERVISEUR', 'COMPTABLE', 'PRE_VENDEUR', 'VENDEUR_CASH_VAN', 'LIVREUR', 'MAGASINIER');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WEB', 'MOBILE');

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('PLATFORM', 'COMPANY');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ReasonKind" AS ENUM ('NO_ORDER', 'DELIVERY_FAILURE', 'ADJUSTMENT', 'FORCED_CLOSE', 'REOPEN');

-- CreateEnum
CREATE TYPE "ReasonSystemCode" AS ENUM ('CUSTOMER_ABSENT', 'STORE_CLOSED', 'CLOSED_PERMANENTLY', 'REFUSED', 'NOT_DELIVERED', 'OTHER');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('DEPOT', 'TRUCK');

-- CreateEnum
CREATE TYPE "ThresholdScope" AS ENUM ('ALL_VARIANTS', 'PER_VARIANT');

-- CreateEnum
CREATE TYPE "FreeVariantMode" AS ENUM ('FIXED', 'SELLER_CHOICE', 'AUTO_MOST_STOCK');

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI');

-- CreateEnum
CREATE TYPE "VisitFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'EVERY_4_WEEKS');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "LostDemandKind" AS ENUM ('LOST_SALE', 'LOST_DEMAND');

-- CreateEnum
CREATE TYPE "WorkdayStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "VisitMode" AS ENUM ('ON_SITE', 'PHONE');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'MISSED');

-- CreateEnum
CREATE TYPE "VisitOutcome" AS ENUM ('ORDER', 'SALE', 'NO_ORDER');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('PRE_SALES', 'PHONE', 'CASH_VAN');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'LOCKED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PARTIALLY_DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderLineKind" AS ENUM ('NORMAL', 'PENDING', 'BONUS');

-- CreateEnum
CREATE TYPE "PendingStatus" AS ENUM ('TO_PROCESS', 'ACCEPTED', 'REFUSED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('IN', 'OUT', 'TRANSFER', 'RESERVATION', 'RELEASE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "StockSourceType" AS ENUM ('ORDER', 'DELIVERY', 'LOAD', 'UNLOAD', 'RECEIPT', 'INVENTORY');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'VALIDATED');

-- CreateEnum
CREATE TYPE "LoadKind" AS ENUM ('ROUTE', 'CASH_VAN', 'RELOAD');

-- CreateEnum
CREATE TYPE "LoadStatus" AS ENUM ('PLANNED', 'LOADED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('DRAFT', 'PREPARING', 'READY', 'LOADED', 'OUT_FOR_DELIVERY', 'CLOSED');

-- CreateEnum
CREATE TYPE "DeliveryResult" AS ENUM ('DELIVERED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('DELIVERY_PAYMENT', 'DEBT_PAYMENT');

-- CreateEnum
CREATE TYPE "DebtEntryKind" AS ENUM ('CREDIT_SALE', 'DEBT_PAYMENT', 'ADVANCE', 'ADVANCE_USED');

-- CreateEnum
CREATE TYPE "PrintDocumentType" AS ENUM ('DELIVERY_NOTE', 'SALE_NOTE', 'DEBT_RECEIPT', 'DAY_SUMMARY');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('APPLIED', 'APPLIED_WITH_CHANGES', 'REJECTED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('IMPORT', 'EXPORT', 'LOGO');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('CUSTOMERS', 'PRODUCTS');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'IMPORTED', 'FAILED');

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "created_by_platform_user_id" UUID,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "platform_user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL DEFAULT 'SUPER_ADMIN',
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_session" (
    "id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "platform_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_log" (
    "id" UUID NOT NULL,
    "platform_user_id" UUID,
    "company_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_module" (
    "id" UUID NOT NULL,
    "module_code" "ModuleCode" NOT NULL,
    "status" "ModuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "activated_at" TIMESTAMPTZ(3),
    "deactivated_at" TIMESTAMPTZ(3),
    "config" JSONB,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "created_by_user_id" UUID,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "scope" "PermissionScope" NOT NULL,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" UUID NOT NULL,
    "permission_code" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_code")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "company_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device" (
    "id" UUID NOT NULL,
    "series" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT,
    "model" TEXT,
    "os_version" TEXT,
    "app_version" TEXT,
    "push_token" TEXT,
    "activated_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3),
    "last_sync_at" TIMESTAMPTZ(3),
    "battery_level" INTEGER,
    "pending_ops" INTEGER NOT NULL DEFAULT 0,
    "last_device_seq" INTEGER NOT NULL DEFAULT 0,
    "last_latitude" DOUBLE PRECISION,
    "last_longitude" DOUBLE PRECISION,
    "last_position_at" TIMESTAMPTZ(3),
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_activation_code" (
    "id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "used_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_activation_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_ping" (
    "id" UUID NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy_m" DOUBLE PRECISION,
    "battery_level" INTEGER,
    "pending_ops" INTEGER NOT NULL DEFAULT 0,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "workday_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_ping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_type" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "company_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reason" (
    "id" UUID NOT NULL,
    "kind" "ReasonKind" NOT NULL,
    "system_code" "ReasonSystemCode",
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "company_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse" (
    "id" UUID NOT NULL,
    "type" "WarehouseType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plate_number" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" UUID NOT NULL,
    "assigned_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_range" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_range_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" UUID NOT NULL,
    "range_id" UUID NOT NULL,
    "category_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_unit" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_qty" INTEGER NOT NULL,
    "is_base" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price" (
    "id" UUID NOT NULL,
    "price" BIGINT NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "customer_type_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_tier" (
    "id" UUID NOT NULL,
    "min_qty" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "threshold_scope" "ThresholdScope" NOT NULL DEFAULT 'ALL_VARIANTS',
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "customer_type_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_rule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "buy_qty" INTEGER NOT NULL,
    "free_qty" INTEGER NOT NULL,
    "free_variant_mode" "FreeVariantMode" NOT NULL DEFAULT 'AUTO_MOST_STOCK',
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" UUID NOT NULL,
    "buy_product_id" UUID NOT NULL,
    "buy_variant_id" UUID,
    "buy_unit_id" UUID NOT NULL,
    "free_product_id" UUID NOT NULL,
    "free_variant_id" UUID,
    "free_unit_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bonus_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_rule_customer_type" (
    "bonus_rule_id" UUID NOT NULL,
    "customer_type_id" UUID NOT NULL,

    CONSTRAINT "bonus_rule_customer_type_pkey" PRIMARY KEY ("bonus_rule_id","customer_type_id")
);

-- CreateTable
CREATE TABLE "territory" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "part_count" INTEGER NOT NULL DEFAULT 6,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" UUID NOT NULL,
    "seller_user_id" UUID,
    "delivery_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "territory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territory_customer_type" (
    "territory_id" UUID NOT NULL,
    "customer_type_id" UUID NOT NULL,

    CONSTRAINT "territory_customer_type_pkey" PRIMARY KEY ("territory_id","customer_type_id")
);

-- CreateTable
CREATE TABLE "territory_part" (
    "id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "geojson" JSONB NOT NULL,
    "min_lat" DOUBLE PRECISION NOT NULL,
    "max_lat" DOUBLE PRECISION NOT NULL,
    "min_lng" DOUBLE PRECISION NOT NULL,
    "max_lng" DOUBLE PRECISION NOT NULL,
    "company_id" UUID NOT NULL,
    "territory_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "territory_part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_schedule" (
    "id" UUID NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "company_id" UUID NOT NULL,
    "territory_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "part_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "is_part_forced" BOOLEAN NOT NULL DEFAULT false,
    "frequency" "VisitFrequency" NOT NULL DEFAULT 'WEEKLY',
    "reference_date" DATE,
    "is_credit_allowed" BOOLEAN NOT NULL DEFAULT false,
    "credit_limit_amount" BIGINT NOT NULL DEFAULT 0,
    "debt_amount" BIGINT NOT NULL DEFAULT 0,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_new" BOOLEAN NOT NULL DEFAULT false,
    "is_cash_only" BOOLEAN NOT NULL DEFAULT false,
    "is_closed_permanently" BOOLEAN NOT NULL DEFAULT false,
    "company_id" UUID NOT NULL,
    "customer_type_id" UUID NOT NULL,
    "territory_id" UUID,
    "part_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_reschedule" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_reschedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "qty" INTEGER NOT NULL,
    "entered_qty" INTEGER NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "entered_unit_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objective" (
    "id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "target_amount" BIGINT NOT NULL,
    "bonus_amount" BIGINT NOT NULL,
    "cap_percent" INTEGER NOT NULL DEFAULT 120,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "range_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "objective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_demand" (
    "id" UUID NOT NULL,
    "kind" "LostDemandKind" NOT NULL,
    "qty" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "order_line_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lost_demand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workday" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "WorkdayStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "started_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "is_started_offline" BOOLEAN NOT NULL DEFAULT false,
    "is_closed_offline" BOOLEAN NOT NULL DEFAULT false,
    "is_force_closed" BOOLEAN NOT NULL DEFAULT false,
    "force_closed_by_user_id" UUID,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "settings_version" INTEGER NOT NULL,
    "expected_cash_amount" BIGINT NOT NULL DEFAULT 0,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "force_close_reason_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "mode" "VisitMode" NOT NULL DEFAULT 'ON_SITE',
    "status" "VisitStatus" NOT NULL,
    "is_scheduled" BOOLEAN NOT NULL DEFAULT true,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "distance_m" INTEGER,
    "is_out_of_zone" BOOLEAN NOT NULL DEFAULT false,
    "is_customer_position_unknown" BOOLEAN NOT NULL DEFAULT false,
    "outcome" "VisitOutcome",
    "company_id" UUID NOT NULL,
    "workday_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "reason_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "source" "OrderSource" NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "order_date" DATE NOT NULL,
    "delivery_date" DATE,
    "total_amount" BIGINT NOT NULL DEFAULT 0,
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "confirmed_at" TIMESTAMPTZ(3),
    "locked_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "company_id" UUID NOT NULL,
    "seller_user_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "customer_type_id" UUID NOT NULL,
    "visit_id" UUID,
    "workday_id" UUID NOT NULL,
    "route_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line" (
    "id" UUID NOT NULL,
    "kind" "OrderLineKind" NOT NULL,
    "pending_status" "PendingStatus",
    "entered_qty" INTEGER NOT NULL,
    "ordered_qty" INTEGER NOT NULL,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "prepared_qty" INTEGER,
    "delivered_qty" INTEGER,
    "unit_price" BIGINT NOT NULL,
    "line_amount" BIGINT NOT NULL,
    "is_stockout" BOOLEAN NOT NULL DEFAULT false,
    "is_bonus_reduced" BOOLEAN NOT NULL DEFAULT false,
    "processed_by_user_id" UUID,
    "processed_at" TIMESTAMPTZ(3),
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "price_tier_id" UUID,
    "bonus_rule_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock" (
    "id" UUID NOT NULL,
    "physical_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "source_type" "StockSourceType",
    "source_id" UUID,
    "device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "company_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "from_warehouse_id" UUID,
    "to_warehouse_id" UUID,
    "reason_id" UUID,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_receipt" (
    "id" UUID NOT NULL,
    "reference" TEXT,
    "supplier" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_receipt_line" (
    "id" UUID NOT NULL,
    "entered_qty" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "company_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_receipt_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count" (
    "id" UUID NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "validated_at" TIMESTAMPTZ(3),
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_count_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_line" (
    "id" UUID NOT NULL,
    "expected_qty" INTEGER NOT NULL,
    "counted_qty" INTEGER NOT NULL,
    "gap_qty" INTEGER NOT NULL,
    "company_id" UUID NOT NULL,
    "inventory_count_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_count_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load" (
    "id" UUID NOT NULL,
    "kind" "LoadKind" NOT NULL,
    "date" DATE NOT NULL,
    "status" "LoadStatus" NOT NULL DEFAULT 'PLANNED',
    "has_gap" BOOLEAN NOT NULL DEFAULT false,
    "planned_by_user_id" UUID,
    "loaded_by_user_id" UUID,
    "loaded_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3),
    "company_id" UUID NOT NULL,
    "truck_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "route_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "load_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_line" (
    "id" UUID NOT NULL,
    "planned_qty" INTEGER NOT NULL,
    "loaded_qty" INTEGER,
    "received_qty" INTEGER,
    "company_id" UUID NOT NULL,
    "load_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "load_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unload" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "keeps_stock_in_truck" BOOLEAN NOT NULL DEFAULT false,
    "validated_by_user_id" UUID,
    "validated_at" TIMESTAMPTZ(3),
    "company_id" UUID NOT NULL,
    "truck_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workday_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "unload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unload_line" (
    "id" UUID NOT NULL,
    "loaded_qty" INTEGER NOT NULL,
    "delivered_qty" INTEGER NOT NULL,
    "free_qty" INTEGER NOT NULL,
    "theoretical_qty" INTEGER NOT NULL,
    "counted_qty" INTEGER NOT NULL,
    "gap_qty" INTEGER NOT NULL,
    "company_id" UUID NOT NULL,
    "unload_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "unload_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_route" (
    "id" UUID NOT NULL,
    "delivery_date" DATE NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'DRAFT',
    "launched_at" TIMESTAMPTZ(3),
    "company_id" UUID NOT NULL,
    "delivery_user_id" UUID NOT NULL,
    "truck_id" UUID,
    "launched_by_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "result" "DeliveryResult" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "delivered_amount" BIGINT NOT NULL DEFAULT 0,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "route_id" UUID,
    "workday_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "due_amount" BIGINT NOT NULL DEFAULT 0,
    "cash_amount" BIGINT NOT NULL DEFAULT 0,
    "credit_amount" BIGINT NOT NULL DEFAULT 0,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workday_id" UUID NOT NULL,
    "order_id" UUID,
    "delivery_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_debt_entry" (
    "id" UUID NOT NULL,
    "kind" "DebtEntryKind" NOT NULL,
    "amount" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "payment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_debt_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement" (
    "id" UUID NOT NULL,
    "expected_amount" BIGINT NOT NULL,
    "remitted_amount" BIGINT NOT NULL,
    "gap_amount" BIGINT NOT NULL,
    "validated_at" TIMESTAMPTZ(3) NOT NULL,
    "is_recalculated" BOOLEAN NOT NULL DEFAULT false,
    "company_id" UUID NOT NULL,
    "workday_id" UUID NOT NULL,
    "accountant_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_log" (
    "id" UUID NOT NULL,
    "document_type" "PrintDocumentType" NOT NULL,
    "document_id" UUID NOT NULL,
    "copy_number" INTEGER NOT NULL,
    "device_id" UUID,
    "printed_at" TIMESTAMPTZ(3) NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "print_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operation" (
    "id" UUID NOT NULL,
    "op_id" UUID NOT NULL,
    "device_seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "result" JSONB,
    "error_code" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "company_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sync_operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "read_at" TIMESTAMPTZ(3),
    "pushed_at" TIMESTAMPTZ(3),
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "change_seq" BIGINT NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_by_device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "device_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "company_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_file" (
    "id" UUID NOT NULL,
    "kind" "FileKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stored_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job" (
    "id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "created_by_user_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_user_email_key" ON "platform_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "platform_session_refresh_token_hash_key" ON "platform_session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "platform_audit_log_company_id_created_at_idx" ON "platform_audit_log"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "company_module_company_id_module_code_key" ON "company_module"("company_id", "module_code");

-- CreateIndex
CREATE UNIQUE INDEX "company_settings_company_id_version_key" ON "company_settings"("company_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "role_company_id_code_key" ON "role"("company_id", "code");

-- CreateIndex
CREATE INDEX "user_company_id_change_seq_idx" ON "user"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "user_company_id_code_key" ON "user"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "user_company_id_email_key" ON "user"("company_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "session_refresh_token_hash_key" ON "session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "session_company_id_user_id_idx" ON "session"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_company_id_user_id_series_key" ON "device"("company_id", "user_id", "series");

-- CreateIndex
CREATE UNIQUE INDEX "device_one_active_per_user" ON "device"("company_id", "user_id") WHERE (status = 'ACTIVE');

-- CreateIndex
CREATE UNIQUE INDEX "device_activation_code_code_hash_key" ON "device_activation_code"("code_hash");

-- CreateIndex
CREATE INDEX "device_activation_code_company_id_idx" ON "device_activation_code"("company_id");

-- CreateIndex
CREATE INDEX "device_ping_company_id_user_id_recorded_at_idx" ON "device_ping"("company_id", "user_id", "recorded_at");

-- CreateIndex
CREATE INDEX "customer_type_company_id_change_seq_idx" ON "customer_type"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "customer_type_company_id_code_key" ON "customer_type"("company_id", "code");

-- CreateIndex
CREATE INDEX "holiday_company_id_change_seq_idx" ON "holiday"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_company_id_date_key" ON "holiday"("company_id", "date");

-- CreateIndex
CREATE INDEX "reason_company_id_change_seq_idx" ON "reason"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "reason_company_id_kind_label_key" ON "reason"("company_id", "kind", "label");

-- CreateIndex
CREATE INDEX "warehouse_company_id_change_seq_idx" ON "warehouse"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_company_id_code_key" ON "warehouse"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_one_truck_per_user" ON "warehouse"("company_id", "assigned_user_id") WHERE (type = 'TRUCK' AND assigned_user_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "product_range_company_id_change_seq_idx" ON "product_range"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "product_range_company_id_code_key" ON "product_range"("company_id", "code");

-- CreateIndex
CREATE INDEX "product_category_company_id_change_seq_idx" ON "product_category"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "product_category_company_id_name_key" ON "product_category"("company_id", "name");

-- CreateIndex
CREATE INDEX "product_company_id_change_seq_idx" ON "product"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "product_company_id_reference_key" ON "product"("company_id", "reference");

-- CreateIndex
CREATE INDEX "product_variant_company_id_change_seq_idx" ON "product_variant"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_company_id_reference_key" ON "product_variant"("company_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_one_default" ON "product_variant"("product_id") WHERE (is_default);

-- CreateIndex
CREATE INDEX "product_unit_company_id_idx" ON "product_unit"("company_id");

-- CreateIndex
CREATE INDEX "product_unit_company_id_change_seq_idx" ON "product_unit"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "product_unit_product_id_name_key" ON "product_unit"("product_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_unit_one_base" ON "product_unit"("product_id") WHERE (is_base);

-- CreateIndex
CREATE INDEX "price_company_id_change_seq_idx" ON "price"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "price_product_unique" ON "price"("company_id", "product_id", "customer_type_id", "unit_id") WHERE (product_variant_id IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "price_variant_unique" ON "price"("company_id", "product_variant_id", "customer_type_id", "unit_id") WHERE (product_variant_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "price_tier_company_id_change_seq_idx" ON "price_tier"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "price_tier_product_unique" ON "price_tier"("company_id", "product_id", "customer_type_id", "unit_id", "min_qty") WHERE (product_variant_id IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "price_tier_variant_unique" ON "price_tier"("company_id", "product_variant_id", "customer_type_id", "unit_id", "min_qty") WHERE (product_variant_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "bonus_rule_company_id_idx" ON "bonus_rule"("company_id");

-- CreateIndex
CREATE INDEX "bonus_rule_company_id_change_seq_idx" ON "bonus_rule"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "territory_company_id_change_seq_idx" ON "territory"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "territory_company_id_code_key" ON "territory"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "territory_company_id_seller_user_id_key" ON "territory"("company_id", "seller_user_id");

-- CreateIndex
CREATE INDEX "territory_part_company_id_idx" ON "territory_part"("company_id");

-- CreateIndex
CREATE INDEX "territory_part_company_id_change_seq_idx" ON "territory_part"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "territory_part_territory_id_number_key" ON "territory_part"("territory_id", "number");

-- CreateIndex
CREATE INDEX "part_schedule_company_id_idx" ON "part_schedule"("company_id");

-- CreateIndex
CREATE INDEX "part_schedule_company_id_change_seq_idx" ON "part_schedule"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "part_schedule_territory_id_weekday_key" ON "part_schedule"("territory_id", "weekday");

-- CreateIndex
CREATE INDEX "customer_company_id_territory_id_part_id_idx" ON "customer"("company_id", "territory_id", "part_id");

-- CreateIndex
CREATE INDEX "customer_company_id_change_seq_idx" ON "customer"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "customer_reschedule_company_id_change_seq_idx" ON "customer_reschedule"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "customer_reschedule_company_id_customer_id_date_key" ON "customer_reschedule"("company_id", "customer_id", "date");

-- CreateIndex
CREATE INDEX "quota_company_id_change_seq_idx" ON "quota"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "quota_company_id_user_id_product_variant_id_date_key" ON "quota"("company_id", "user_id", "product_variant_id", "date");

-- CreateIndex
CREATE INDEX "objective_company_id_change_seq_idx" ON "objective"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "objective_company_id_user_id_range_id_month_key" ON "objective"("company_id", "user_id", "range_id", "month");

-- CreateIndex
CREATE INDEX "lost_demand_company_id_date_idx" ON "lost_demand"("company_id", "date");

-- CreateIndex
CREATE INDEX "lost_demand_company_id_change_seq_idx" ON "lost_demand"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "workday_company_id_change_seq_idx" ON "workday"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "workday_company_id_user_id_date_key" ON "workday"("company_id", "user_id", "date");

-- CreateIndex
CREATE INDEX "visit_company_id_date_user_id_idx" ON "visit"("company_id", "date", "user_id");

-- CreateIndex
CREATE INDEX "visit_company_id_customer_id_date_idx" ON "visit"("company_id", "customer_id", "date");

-- CreateIndex
CREATE INDEX "visit_company_id_change_seq_idx" ON "visit"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "order_visit_id_key" ON "order"("visit_id");

-- CreateIndex
CREATE INDEX "order_company_id_delivery_date_status_idx" ON "order"("company_id", "delivery_date", "status");

-- CreateIndex
CREATE INDEX "order_company_id_seller_user_id_order_date_idx" ON "order"("company_id", "seller_user_id", "order_date");

-- CreateIndex
CREATE INDEX "order_company_id_change_seq_idx" ON "order"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "order_company_id_number_key" ON "order"("company_id", "number");

-- CreateIndex
CREATE INDEX "order_line_order_id_idx" ON "order_line"("order_id");

-- CreateIndex
CREATE INDEX "order_line_company_id_idx" ON "order_line"("company_id");

-- CreateIndex
CREATE INDEX "order_line_company_id_change_seq_idx" ON "order_line"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "order_line_one_per_kind" ON "order_line"("order_id", "product_variant_id", "kind") WHERE (kind <> 'BONUS');

-- CreateIndex
CREATE INDEX "stock_company_id_change_seq_idx" ON "stock"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "stock_company_id_warehouse_id_product_variant_id_key" ON "stock"("company_id", "warehouse_id", "product_variant_id");

-- CreateIndex
CREATE INDEX "stock_movement_company_id_product_variant_id_occurred_at_idx" ON "stock_movement"("company_id", "product_variant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_receipt_company_id_idx" ON "stock_receipt"("company_id");

-- CreateIndex
CREATE INDEX "stock_receipt_company_id_change_seq_idx" ON "stock_receipt"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "stock_receipt_line_company_id_idx" ON "stock_receipt_line"("company_id");

-- CreateIndex
CREATE INDEX "stock_receipt_line_company_id_change_seq_idx" ON "stock_receipt_line"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "inventory_count_company_id_idx" ON "inventory_count"("company_id");

-- CreateIndex
CREATE INDEX "inventory_count_company_id_change_seq_idx" ON "inventory_count"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "inventory_count_line_company_id_idx" ON "inventory_count_line"("company_id");

-- CreateIndex
CREATE INDEX "inventory_count_line_company_id_change_seq_idx" ON "inventory_count_line"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "load_company_id_truck_id_date_idx" ON "load"("company_id", "truck_id", "date");

-- CreateIndex
CREATE INDEX "load_company_id_change_seq_idx" ON "load"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "load_line_company_id_idx" ON "load_line"("company_id");

-- CreateIndex
CREATE INDEX "load_line_company_id_change_seq_idx" ON "load_line"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "load_line_load_id_product_variant_id_key" ON "load_line"("load_id", "product_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "unload_workday_id_key" ON "unload"("workday_id");

-- CreateIndex
CREATE INDEX "unload_company_id_idx" ON "unload"("company_id");

-- CreateIndex
CREATE INDEX "unload_company_id_change_seq_idx" ON "unload"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "unload_line_company_id_idx" ON "unload_line"("company_id");

-- CreateIndex
CREATE INDEX "unload_line_company_id_change_seq_idx" ON "unload_line"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "delivery_route_company_id_change_seq_idx" ON "delivery_route"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_route_company_id_delivery_user_id_delivery_date_key" ON "delivery_route"("company_id", "delivery_user_id", "delivery_date");

-- CreateIndex
CREATE INDEX "delivery_company_id_change_seq_idx" ON "delivery"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_company_id_number_key" ON "delivery"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_company_id_order_id_attempt_key" ON "delivery"("company_id", "order_id", "attempt");

-- CreateIndex
CREATE INDEX "payment_company_id_change_seq_idx" ON "payment"("company_id", "change_seq");

-- CreateIndex
CREATE UNIQUE INDEX "payment_company_id_number_key" ON "payment"("company_id", "number");

-- CreateIndex
CREATE INDEX "customer_debt_entry_company_id_customer_id_occurred_at_idx" ON "customer_debt_entry"("company_id", "customer_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_workday_id_key" ON "settlement"("workday_id");

-- CreateIndex
CREATE INDEX "settlement_company_id_idx" ON "settlement"("company_id");

-- CreateIndex
CREATE INDEX "print_log_company_id_document_id_idx" ON "print_log"("company_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_operation_company_id_op_id_key" ON "sync_operation"("company_id", "op_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_operation_device_id_device_seq_key" ON "sync_operation"("device_id", "device_seq");

-- CreateIndex
CREATE INDEX "notification_company_id_user_id_read_at_idx" ON "notification"("company_id", "user_id", "read_at");

-- CreateIndex
CREATE INDEX "notification_company_id_change_seq_idx" ON "notification"("company_id", "change_seq");

-- CreateIndex
CREATE INDEX "audit_log_company_id_entity_entity_id_idx" ON "audit_log"("company_id", "entity", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "stored_file_storage_key_key" ON "stored_file"("storage_key");

-- CreateIndex
CREATE INDEX "stored_file_company_id_idx" ON "stored_file"("company_id");

-- CreateIndex
CREATE INDEX "import_job_company_id_idx" ON "import_job"("company_id");

-- AddForeignKey
ALTER TABLE "platform_session" ADD CONSTRAINT "platform_session_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_module" ADD CONSTRAINT "company_module_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permission"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_activation_code" ADD CONSTRAINT "device_activation_code_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_activation_code" ADD CONSTRAINT "device_activation_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_activation_code" ADD CONSTRAINT "device_activation_code_used_by_device_id_fkey" FOREIGN KEY ("used_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_ping" ADD CONSTRAINT "device_ping_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_ping" ADD CONSTRAINT "device_ping_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_ping" ADD CONSTRAINT "device_ping_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_ping" ADD CONSTRAINT "device_ping_workday_id_fkey" FOREIGN KEY ("workday_id") REFERENCES "workday"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_type" ADD CONSTRAINT "customer_type_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reason" ADD CONSTRAINT "reason_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_range" ADD CONSTRAINT "product_range_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_range_id_fkey" FOREIGN KEY ("range_id") REFERENCES "product_range"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_unit" ADD CONSTRAINT "product_unit_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_unit" ADD CONSTRAINT "product_unit_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price" ADD CONSTRAINT "price_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price" ADD CONSTRAINT "price_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price" ADD CONSTRAINT "price_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price" ADD CONSTRAINT "price_customer_type_id_fkey" FOREIGN KEY ("customer_type_id") REFERENCES "customer_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price" ADD CONSTRAINT "price_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tier" ADD CONSTRAINT "price_tier_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tier" ADD CONSTRAINT "price_tier_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tier" ADD CONSTRAINT "price_tier_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tier" ADD CONSTRAINT "price_tier_customer_type_id_fkey" FOREIGN KEY ("customer_type_id") REFERENCES "customer_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tier" ADD CONSTRAINT "price_tier_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_rule" ADD CONSTRAINT "bonus_rule_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_rule" ADD CONSTRAINT "bonus_rule_buy_product_id_fkey" FOREIGN KEY ("buy_product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_rule" ADD CONSTRAINT "bonus_rule_buy_variant_id_fkey" FOREIGN KEY ("buy_variant_id") REFERENCES "product_variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_rule" ADD CONSTRAINT "bonus_rule_buy_unit_id_fkey" FOREIGN KEY ("buy_unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_rule" ADD CONSTRAINT "bonus_rule_free_product_id_fkey" FOREIGN KEY ("free_product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_rule" ADD CONSTRAINT "bonus_rule_free_variant_id_fkey" FOREIGN KEY ("free_variant_id") REFERENCES "product_variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_rule" ADD CONSTRAINT "bonus_rule_free_unit_id_fkey" FOREIGN KEY ("free_unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_rule_customer_type" ADD CONSTRAINT "bonus_rule_customer_type_bonus_rule_id_fkey" FOREIGN KEY ("bonus_rule_id") REFERENCES "bonus_rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_rule_customer_type" ADD CONSTRAINT "bonus_rule_customer_type_customer_type_id_fkey" FOREIGN KEY ("customer_type_id") REFERENCES "customer_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory" ADD CONSTRAINT "territory_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory" ADD CONSTRAINT "territory_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory" ADD CONSTRAINT "territory_delivery_user_id_fkey" FOREIGN KEY ("delivery_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_customer_type" ADD CONSTRAINT "territory_customer_type_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_customer_type" ADD CONSTRAINT "territory_customer_type_customer_type_id_fkey" FOREIGN KEY ("customer_type_id") REFERENCES "customer_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_part" ADD CONSTRAINT "territory_part_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_part" ADD CONSTRAINT "territory_part_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_schedule" ADD CONSTRAINT "part_schedule_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_schedule" ADD CONSTRAINT "part_schedule_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_schedule" ADD CONSTRAINT "part_schedule_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "territory_part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_customer_type_id_fkey" FOREIGN KEY ("customer_type_id") REFERENCES "customer_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "territory_part"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_reschedule" ADD CONSTRAINT "customer_reschedule_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_reschedule" ADD CONSTRAINT "customer_reschedule_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota" ADD CONSTRAINT "quota_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota" ADD CONSTRAINT "quota_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota" ADD CONSTRAINT "quota_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota" ADD CONSTRAINT "quota_entered_unit_id_fkey" FOREIGN KEY ("entered_unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective" ADD CONSTRAINT "objective_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective" ADD CONSTRAINT "objective_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective" ADD CONSTRAINT "objective_range_id_fkey" FOREIGN KEY ("range_id") REFERENCES "product_range"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_demand" ADD CONSTRAINT "lost_demand_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_demand" ADD CONSTRAINT "lost_demand_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_demand" ADD CONSTRAINT "lost_demand_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_demand" ADD CONSTRAINT "lost_demand_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_demand" ADD CONSTRAINT "lost_demand_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "order_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workday" ADD CONSTRAINT "workday_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workday" ADD CONSTRAINT "workday_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workday" ADD CONSTRAINT "workday_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workday" ADD CONSTRAINT "workday_force_close_reason_id_fkey" FOREIGN KEY ("force_close_reason_id") REFERENCES "reason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_workday_id_fkey" FOREIGN KEY ("workday_id") REFERENCES "workday"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "reason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_customer_type_id_fkey" FOREIGN KEY ("customer_type_id") REFERENCES "customer_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_workday_id_fkey" FOREIGN KEY ("workday_id") REFERENCES "workday"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "delivery_route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_price_tier_id_fkey" FOREIGN KEY ("price_tier_id") REFERENCES "price_tier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_bonus_rule_id_fkey" FOREIGN KEY ("bonus_rule_id") REFERENCES "bonus_rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "reason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "stock_receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count" ADD CONSTRAINT "inventory_count_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count" ADD CONSTRAINT "inventory_count_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_line" ADD CONSTRAINT "inventory_count_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_line" ADD CONSTRAINT "inventory_count_line_inventory_count_id_fkey" FOREIGN KEY ("inventory_count_id") REFERENCES "inventory_count"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_line" ADD CONSTRAINT "inventory_count_line_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load" ADD CONSTRAINT "load_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load" ADD CONSTRAINT "load_truck_id_fkey" FOREIGN KEY ("truck_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load" ADD CONSTRAINT "load_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load" ADD CONSTRAINT "load_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "delivery_route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_line" ADD CONSTRAINT "load_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_line" ADD CONSTRAINT "load_line_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_line" ADD CONSTRAINT "load_line_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unload" ADD CONSTRAINT "unload_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unload" ADD CONSTRAINT "unload_truck_id_fkey" FOREIGN KEY ("truck_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unload" ADD CONSTRAINT "unload_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unload" ADD CONSTRAINT "unload_workday_id_fkey" FOREIGN KEY ("workday_id") REFERENCES "workday"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unload_line" ADD CONSTRAINT "unload_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unload_line" ADD CONSTRAINT "unload_line_unload_id_fkey" FOREIGN KEY ("unload_id") REFERENCES "unload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unload_line" ADD CONSTRAINT "unload_line_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route" ADD CONSTRAINT "delivery_route_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route" ADD CONSTRAINT "delivery_route_delivery_user_id_fkey" FOREIGN KEY ("delivery_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route" ADD CONSTRAINT "delivery_route_truck_id_fkey" FOREIGN KEY ("truck_id") REFERENCES "warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route" ADD CONSTRAINT "delivery_route_launched_by_user_id_fkey" FOREIGN KEY ("launched_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "delivery_route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_workday_id_fkey" FOREIGN KEY ("workday_id") REFERENCES "workday"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "reason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_workday_id_fkey" FOREIGN KEY ("workday_id") REFERENCES "workday"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_debt_entry" ADD CONSTRAINT "customer_debt_entry_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_debt_entry" ADD CONSTRAINT "customer_debt_entry_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_debt_entry" ADD CONSTRAINT "customer_debt_entry_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_workday_id_fkey" FOREIGN KEY ("workday_id") REFERENCES "workday"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_accountant_user_id_fkey" FOREIGN KEY ("accountant_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_log" ADD CONSTRAINT "print_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_log" ADD CONSTRAINT "print_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_operation" ADD CONSTRAINT "sync_operation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_operation" ADD CONSTRAINT "sync_operation_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_operation" ADD CONSTRAINT "sync_operation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
