import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

/** Nombre de caractères par ligne selon la largeur du papier (architecture §13.1). */
export const COLUMNS_BY_WIDTH = { 58: 32, 80: 48 } as const;
export type TicketWidth = keyof typeof COLUMNS_BY_WIDTH;

/**
 * Ticket de test de la phase 2 : accents français, alignements, gras, ligne longue.
 * Fonction pure : elle se teste sans imprimante.
 */
export function encodeTestTicket(width: TicketWidth, printedAt: Date): Uint8Array {
  const encoder = new ReceiptPrinterEncoder({
    language: 'esc-pos',
    columns: COLUMNS_BY_WIDTH[width],
    codepageMapping: 'epson',
  });

  return encoder
    .initialize()
    .align('center')
    .bold(true)
    .line('SELLWASL')
    .bold(false)
    .line('One Platform. Every Flow.')
    .newline()
    .align('left')
    .line(`Test d'impression ${width} mm`)
    .line(printedAt.toLocaleString('fr-DZ'))
    .rule()
    .table(
      [
        { width: COLUMNS_BY_WIDTH[width] - 12, align: 'left' },
        { width: 12, align: 'right' },
      ],
      [
        ['Thon tomate x12', '67 200 DA'],
        ['Biscuit Bimo fraise x4', '4 600 DA'],
        ['GRATUIT Thon huile x8', '0 DA'],
      ],
    )
    .rule()
    .bold(true)
    .line('Accents : é è ê à ç ù ô î')
    .bold(false)
    .line('Une ligne très longue pour vérifier le retour automatique à la ligne du ticket.')
    .newline(3)
    .cut()
    .encode();
}
