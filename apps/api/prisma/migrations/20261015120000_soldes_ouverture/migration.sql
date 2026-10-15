-- Soldes d'ouverture des dettes (BR-PAY-09)
ALTER TYPE "DebtEntryKind" ADD VALUE 'OPENING_BALANCE';
ALTER TYPE "ImportKind" ADD VALUE 'OPENING_DEBTS';

INSERT INTO "permission" ("code", "description", "scope") VALUES
  ('debts.opening', 'Inscrire les soldes d''ouverture des dettes', 'COMPANY')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permission" ("role_id", "permission_code")
SELECT r.id, 'debts.opening' FROM "role" r WHERE r.code IN ('COMPANY_ADMIN', 'COMPTABLE')
ON CONFLICT DO NOTHING;
