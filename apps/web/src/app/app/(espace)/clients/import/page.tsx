'use client';

import { ImportPanel } from '@/components/import-panel';

const Col = ({ children }: { children: string }) => <span className="font-mono">{children}</span>;

/** Import CSV des clients (UC-83, BR-IO-01). */
export default function CustomerImportPage() {
  return (
    <ImportPanel
      kind="CUSTOMERS"
      title="Importer des clients"
      backHref="/app/clients"
      backLabel="Retour aux clients"
      templateName="modele-clients.csv"
      unit="client(s)"
      help={
        <p>
          Colonnes : <Col>nom</Col> et <Col>type</Col> (obligatoires), <Col>code</Col>,{' '}
          <Col>telephone</Col>, <Col>adresse</Col>, <Col>latitude</Col>, <Col>longitude</Col>,{' '}
          <Col>frequence</Col> (1, 2 ou 4 semaines), <Col>credit_autorise</Col> (oui ou non),{' '}
          <Col>plafond_credit</Col> (DA). Un client sans position, ou dont la position n'est dans
          aucune partie, est importé « hors partie » et apparaît dans les clients à revoir.
        </p>
      }
    />
  );
}
