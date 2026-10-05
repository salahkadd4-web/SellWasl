-- AlterTable
ALTER TABLE "product_variant" ADD COLUMN     "low_stock_qty" INTEGER;

-- Seuil de stock faible jamais négatif
ALTER TABLE "product_variant" ADD CONSTRAINT product_variant_low_stock_check CHECK (low_stock_qty IS NULL OR low_stock_qty >= 0);

-- Opérations de stock sur le Web pour l'admin et le superviseur (le magasinier est mobile seulement)
INSERT INTO "role_permission" ("role_id", "permission_code")
SELECT r.id, p.code FROM "role" r
CROSS JOIN (VALUES ('stock.receive'), ('inventory.count'), ('loads.load'), ('unloads.validate')) AS p(code)
WHERE r.code IN ('COMPANY_ADMIN', 'SUPERVISEUR')
ON CONFLICT DO NOTHING;

-- Motifs d'écart de déchargement (BR-STK-07)
INSERT INTO "reason" ("id", "company_id", "kind", "label", "updated_at")
SELECT gen_random_uuid(), c.id, 'ADJUSTMENT', l.label, CURRENT_TIMESTAMP FROM "company" c
CROSS JOIN (VALUES ('Retour client'), ('Marchandise manquante')) AS l(label)
ON CONFLICT DO NOTHING;
