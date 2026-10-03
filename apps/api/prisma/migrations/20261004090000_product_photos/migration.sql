-- Photos des produits et des parfums : clé du fichier chez le fournisseur d'images
-- (« cloudinary:v<version>/<public_id> » ou « local:<chemin> »).
ALTER TABLE "product" ADD COLUMN "photo_key" TEXT;
ALTER TABLE "product_variant" ADD COLUMN "photo_key" TEXT;
