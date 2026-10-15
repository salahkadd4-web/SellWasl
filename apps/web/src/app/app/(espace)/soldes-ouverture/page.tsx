'use client';

import { AccountingTabs } from '@/components/accounting-tabs';
import { ImportPanel } from '@/components/import-panel';

const Col = ({ children }: { children: string }) => <span className="font-mono">{children}</span>;

/** Soldes d'ouverture des dettes, importés le soir du passage à SellWasl (BR-PAY-09). */
export default function OpeningDebtsPage() {
  return (
    <ImportPanel
      kind="OPENING_DEBTS"
      title="Soldes d'ouverture"
      backHref="/app/paiements"
      backLabel="Dettes et paiements"
      templateName="modele-soldes.csv"
      unit="solde(s)"
      tabs={<AccountingTabs />}
      help={
        <p>
          Dette de chaque client dans l'ancien système, à importer le soir du passage à SellWasl.
          Colonnes : <Col>code</Col> (code du client) et <Col>dette</Col> (DA, entier),{' '}
          <Col>nom</Col> facultatif. Un solde reste modifiable tant que le client n'a ni vente à
          crédit ni encaissement de dette ; les clients absents du fichier ne changent pas. Un solde
          se corrige aussi sur la fiche du client.
        </p>
      }
    />
  );
}
