-- Préparation des tournées sur le Web pour l'admin et le superviseur (phase 18)
INSERT INTO "role_permission" ("role_id", "permission_code")
SELECT r.id, 'preparation.do' FROM "role" r
WHERE r.code IN ('COMPANY_ADMIN', 'SUPERVISEUR')
ON CONFLICT DO NOTHING;
