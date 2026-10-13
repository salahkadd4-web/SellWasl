-- Seuil minimum des objectifs du mois, vendeur et livreur (BR-OBJ-05)
ALTER TABLE "objective" ADD COLUMN "min_percent" INTEGER;
ALTER TABLE "driver_objective" ADD COLUMN "min_percent" INTEGER;

-- Objectif du jour, payé à la semaine, porté par une règle de prime (BR-OBJ-06)
ALTER TYPE "IncentiveKind" ADD VALUE 'DAILY_TARGET';
ALTER TABLE "incentive_rule"
  ADD COLUMN "daily_target" INTEGER,
  ADD COLUMN "cap_percent" INTEGER,
  ADD COLUMN "min_qty" INTEGER;

-- Permissions du superviseur réglées par l'administrateur (docs/rbac.md §7 bis)
INSERT INTO "permission" ("code", "description", "scope") VALUES
  ('roles.manage', 'Régler les permissions du superviseur', 'COMPANY')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permission" ("role_id", "permission_code")
SELECT r.id, 'roles.manage' FROM "role" r WHERE r.code = 'COMPANY_ADMIN'
ON CONFLICT DO NOTHING;
