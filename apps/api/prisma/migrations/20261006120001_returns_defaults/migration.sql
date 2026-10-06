-- Droits de l'analyse des retours (phase 21)
INSERT INTO "permission" ("code", "description", "scope") VALUES
  ('returns.read', 'Analyse des retours', 'COMPANY'),
  ('returns.contest', 'Contester un refus déclaré par le livreur', 'COMPANY'),
  ('returns.decide', 'Trancher une contestation de refus', 'COMPANY')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permission" ("role_id", "permission_code")
SELECT r.id, p.code FROM "role" r
CROSS JOIN (VALUES ('returns.read'), ('returns.decide')) AS p(code)
WHERE r.code IN ('COMPANY_ADMIN', 'SUPERVISEUR')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permission" ("role_id", "permission_code")
SELECT r.id, 'returns.contest' FROM "role" r WHERE r.code = 'PRE_VENDEUR'
ON CONFLICT DO NOTHING;

-- Motifs de refus d'une livraison (BR-RET-01)
INSERT INTO "reason" ("id", "company_id", "kind", "label", "system_code", "sort_order", "updated_at")
SELECT gen_random_uuid(), c.id, 'REFUSAL', l.label, l.code::"ReasonSystemCode", l.sort, CURRENT_TIMESTAMP
FROM "company" c
CROSS JOIN (VALUES
  ('Produit non commandé', NULL, 1),
  ('Prix', NULL, 2),
  ('Pas d''argent', NULL, 3),
  ('Stock suffisant', NULL, 4),
  ('Produit abîmé', NULL, 5),
  ('Date proche', NULL, 6),
  ('Autre', 'OTHER', 7)
) AS l(label, code, sort)
ON CONFLICT DO NOTHING;
