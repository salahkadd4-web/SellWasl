'use client';

import { CatalogTabs } from '@/components/catalog-tabs';
import { ImportPanel } from '@/components/import-panel';

const Col = ({ children }: { children: string }) => <span className="font-mono">{children}</span>;

/** Import CSV des produits, parfums, conditionnements et prix (UC-83, BR-IO-02). */
export default function ProductImportPage() {
  return (
    <div className="flex flex-col gap-4">
      <CatalogTabs />
      <ImportPanel
        kind="PRODUCTS"
        title="Importer des produits"
        backHref="/app/produits"
        backLabel="Retour au catalogue"
        templateName="modele-produits.csv"
        unit="ligne(s)"
        help={
          <div className="flex flex-col gap-2">
            <p>
              Une ligne par produit, avec <Col>reference_produit</Col>, <Col>nom_produit</Col>,{' '}
              <Col>gamme</Col>, <Col>categorie</Col>, <Col>unite_base</Col> et{' '}
              <Col>conditionnements</Col> (ex. <Col>carton=24|pack=6</Col>). Puis, si le produit a
              des parfums, une ligne par parfum avec la même <Col>reference_produit</Col>,{' '}
              <Col>reference_parfum</Col> et <Col>nom_parfum</Col>.
            </p>
            <p>
              Prix en DA dans les colonnes <Col>prix_TYPE_unité</Col> (ex.{' '}
              <Col>prix_DETAIL_carton</Col>) : sur la ligne du produit, son prix ; sur la ligne d'un
              parfum, son prix propre, à laisser vide s'il a le prix du produit. Une gamme ou une
              catégorie inconnue est créée. L'import crée des produits ; il ne modifie pas les
              produits existants.
            </p>
          </div>
        }
      />
    </div>
  );
}
