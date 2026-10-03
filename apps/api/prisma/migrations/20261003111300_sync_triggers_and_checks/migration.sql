-- Ce que Prisma ne sait pas exprimer dans schema.prisma (docs/database.md §1.2, §1.3, §15, §16).
-- Prisma ignore les séquences, fonctions, triggers et contraintes CHECK : ils ne créent pas de dérive.

-- ---------------------------------------------------------------------------
-- 1. Curseur de synchronisation (architecture §10.3)
--    Chaque création ou modification d'une ligne synchronisée reçoit un change_seq
--    croissant ; une modification incrémente aussi version.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE sync_change_seq AS BIGINT;

CREATE FUNCTION sync_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.change_seq := nextval('sync_change_seq');
  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_sync_change BEFORE INSERT OR UPDATE ON "user" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER customer_type_sync_change BEFORE INSERT OR UPDATE ON "customer_type" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER holiday_sync_change BEFORE INSERT OR UPDATE ON "holiday" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER reason_sync_change BEFORE INSERT OR UPDATE ON "reason" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER warehouse_sync_change BEFORE INSERT OR UPDATE ON "warehouse" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER product_range_sync_change BEFORE INSERT OR UPDATE ON "product_range" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER product_category_sync_change BEFORE INSERT OR UPDATE ON "product_category" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER product_sync_change BEFORE INSERT OR UPDATE ON "product" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER product_variant_sync_change BEFORE INSERT OR UPDATE ON "product_variant" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER product_unit_sync_change BEFORE INSERT OR UPDATE ON "product_unit" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER price_sync_change BEFORE INSERT OR UPDATE ON "price" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER price_tier_sync_change BEFORE INSERT OR UPDATE ON "price_tier" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER bonus_rule_sync_change BEFORE INSERT OR UPDATE ON "bonus_rule" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER territory_sync_change BEFORE INSERT OR UPDATE ON "territory" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER territory_part_sync_change BEFORE INSERT OR UPDATE ON "territory_part" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER part_schedule_sync_change BEFORE INSERT OR UPDATE ON "part_schedule" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER customer_sync_change BEFORE INSERT OR UPDATE ON "customer" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER customer_reschedule_sync_change BEFORE INSERT OR UPDATE ON "customer_reschedule" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER quota_sync_change BEFORE INSERT OR UPDATE ON "quota" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER objective_sync_change BEFORE INSERT OR UPDATE ON "objective" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER lost_demand_sync_change BEFORE INSERT OR UPDATE ON "lost_demand" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER workday_sync_change BEFORE INSERT OR UPDATE ON "workday" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER visit_sync_change BEFORE INSERT OR UPDATE ON "visit" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER order_sync_change BEFORE INSERT OR UPDATE ON "order" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER order_line_sync_change BEFORE INSERT OR UPDATE ON "order_line" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER stock_sync_change BEFORE INSERT OR UPDATE ON "stock" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER stock_receipt_sync_change BEFORE INSERT OR UPDATE ON "stock_receipt" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER stock_receipt_line_sync_change BEFORE INSERT OR UPDATE ON "stock_receipt_line" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER inventory_count_sync_change BEFORE INSERT OR UPDATE ON "inventory_count" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER inventory_count_line_sync_change BEFORE INSERT OR UPDATE ON "inventory_count_line" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER load_sync_change BEFORE INSERT OR UPDATE ON "load" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER load_line_sync_change BEFORE INSERT OR UPDATE ON "load_line" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER unload_sync_change BEFORE INSERT OR UPDATE ON "unload" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER unload_line_sync_change BEFORE INSERT OR UPDATE ON "unload_line" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER delivery_route_sync_change BEFORE INSERT OR UPDATE ON "delivery_route" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER delivery_sync_change BEFORE INSERT OR UPDATE ON "delivery" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER payment_sync_change BEFORE INSERT OR UPDATE ON "payment" FOR EACH ROW EXECUTE FUNCTION sync_row_change();
CREATE TRIGGER notification_sync_change BEFORE INSERT OR UPDATE ON "notification" FOR EACH ROW EXECUTE FUNCTION sync_row_change();

-- ---------------------------------------------------------------------------
-- 2. Tables en ajout seul : aucune modification ni suppression (BR-AUD-01, BR-STK-03, BR-PAY-04)
-- ---------------------------------------------------------------------------
CREATE FUNCTION forbid_append_only_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La table % est en ajout seul : % interdit', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION forbid_append_only_change();
CREATE TRIGGER platform_audit_log_append_only BEFORE UPDATE OR DELETE ON "platform_audit_log" FOR EACH ROW EXECUTE FUNCTION forbid_append_only_change();
CREATE TRIGGER stock_movement_append_only BEFORE UPDATE OR DELETE ON "stock_movement" FOR EACH ROW EXECUTE FUNCTION forbid_append_only_change();
CREATE TRIGGER customer_debt_entry_append_only BEFORE UPDATE OR DELETE ON "customer_debt_entry" FOR EACH ROW EXECUTE FUNCTION forbid_append_only_change();

-- ---------------------------------------------------------------------------
-- 3. Contraintes CHECK : invariants simples (docs/database.md §1.3)
-- ---------------------------------------------------------------------------
ALTER TABLE "stock" ADD CONSTRAINT stock_quantities_check
  CHECK (physical_qty >= 0 AND reserved_qty >= 0 AND reserved_qty <= physical_qty);        -- BR-STK-04
ALTER TABLE "stock_movement" ADD CONSTRAINT stock_movement_qty_check CHECK (qty > 0);
ALTER TABLE "product_unit" ADD CONSTRAINT product_unit_base_qty_check CHECK (base_qty >= 1);
ALTER TABLE "price" ADD CONSTRAINT price_price_check CHECK (price >= 0);
ALTER TABLE "price_tier" ADD CONSTRAINT price_tier_values_check CHECK (min_qty > 0 AND unit_price >= 0);
ALTER TABLE "bonus_rule" ADD CONSTRAINT bonus_rule_quantities_check CHECK (buy_qty > 0 AND free_qty > 0);
ALTER TABLE "bonus_rule" ADD CONSTRAINT bonus_rule_fixed_variant_check
  CHECK (free_variant_mode <> 'FIXED' OR free_variant_id IS NOT NULL);
ALTER TABLE "bonus_rule" ADD CONSTRAINT bonus_rule_validity_check CHECK (valid_to IS NULL OR valid_to >= valid_from);
ALTER TABLE "customer" ADD CONSTRAINT customer_credit_limit_check CHECK (credit_limit_amount >= 0);
ALTER TABLE "quota" ADD CONSTRAINT quota_qty_check CHECK (qty >= 0 AND entered_qty >= 0);
ALTER TABLE "objective" ADD CONSTRAINT objective_values_check
  CHECK (target_amount > 0 AND bonus_amount >= 0 AND cap_percent >= 100);
ALTER TABLE "lost_demand" ADD CONSTRAINT lost_demand_qty_check CHECK (qty > 0);
ALTER TABLE "order" ADD CONSTRAINT order_total_check CHECK (total_amount >= 0);
ALTER TABLE "order_line" ADD CONSTRAINT order_line_quantities_check CHECK (
  entered_qty >= 0 AND ordered_qty >= 0 AND reserved_qty >= 0 AND reserved_qty <= ordered_qty
  AND (prepared_qty IS NULL OR prepared_qty >= 0) AND (delivered_qty IS NULL OR delivered_qty >= 0)
  AND unit_price >= 0 AND line_amount >= 0
);
ALTER TABLE "order_line" ADD CONSTRAINT order_line_pending_check
  CHECK ((kind = 'PENDING') = (pending_status IS NOT NULL));                                -- BR-QUO-03
ALTER TABLE "load_line" ADD CONSTRAINT load_line_quantities_check CHECK (
  planned_qty >= 0 AND (loaded_qty IS NULL OR loaded_qty >= 0) AND (received_qty IS NULL OR received_qty >= 0)
);
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT stock_receipt_line_qty_check CHECK (qty > 0);
ALTER TABLE "inventory_count_line" ADD CONSTRAINT inventory_count_line_qty_check
  CHECK (expected_qty >= 0 AND counted_qty >= 0);
ALTER TABLE "unload_line" ADD CONSTRAINT unload_line_counted_check CHECK (counted_qty >= 0);
ALTER TABLE "delivery" ADD CONSTRAINT delivery_attempt_check CHECK (attempt BETWEEN 1 AND 2);   -- P-05
ALTER TABLE "payment" ADD CONSTRAINT payment_amounts_check
  CHECK (cash_amount >= 0 AND credit_amount >= 0 AND due_amount >= 0);
ALTER TABLE "settlement" ADD CONSTRAINT settlement_amounts_check
  CHECK (expected_amount >= 0 AND remitted_amount >= 0 AND gap_amount = remitted_amount - expected_amount);
ALTER TABLE "company_settings" ADD CONSTRAINT company_settings_version_check CHECK (version >= 1);
ALTER TABLE "territory_part" ADD CONSTRAINT territory_part_bbox_check CHECK (min_lat <= max_lat AND min_lng <= max_lng);
