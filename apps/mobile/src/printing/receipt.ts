import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import type { DaySummaryDto, ReceiptPrintDto, TicketSettingsDto } from '@sellwasl/validation';

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

const KIND_TITLE = {
  DELIVERY: 'BON DE LIVRAISON',
  SALE: 'BON DE VENTE',
  DEBT: 'REÇU DE DETTE',
} as const;

/** Montant sans espace insécable : certaines imprimantes ne le connaissent pas. */
function digits(amount: number): string {
  return String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const money = (amount: number) => `${digits(amount)} DA`;

/** Date et heure locales du téléphone, « 08/05/2027 14:05 ». */
function stamp(iso: string): string {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function encoderFor(width: TicketWidth) {
  return new ReceiptPrinterEncoder({
    language: 'esc-pos',
    columns: COLUMNS_BY_WIDTH[width],
    codepageMapping: 'epson',
  });
}

type Encoder = ReturnType<typeof encoderFor>;

function header(encoder: Encoder, ticket: TicketSettingsDto): Encoder {
  encoder.initialize().align('center');
  const { name, address, phone } = ticket.header;
  if (name) encoder.bold(true).line(name).bold(false);
  if (address) encoder.line(address);
  if (phone) encoder.line(`Tél. ${phone}`);
  return encoder.newline();
}

/** Deux colonnes : libellé à gauche, montant à droite. */
function pairs(encoder: Encoder, width: TicketWidth, rows: [string, string][]): Encoder {
  const right = width === 80 ? 16 : 13;
  return encoder.table(
    [
      { width: COLUMNS_BY_WIDTH[width] - right, align: 'left' },
      { width: right, align: 'right' },
    ],
    rows,
  );
}

/**
 * Bon de livraison, de vente ou reçu de dette (BR-IMP-02, BR-IMP-05) ; une réimpression porte
 * « DUPLICATA » (BR-IMP-03). Fonction pure : elle se teste sans imprimante.
 */
export function encodeReceipt(
  receipt: ReceiptPrintDto,
  ticket: TicketSettingsDto,
  options: { duplicate: boolean },
): Uint8Array {
  const width = ticket.widthMm;
  const encoder = header(encoderFor(width), ticket)
    .bold(true)
    .line(KIND_TITLE[receipt.kind])
    .bold(false);
  if (options.duplicate) encoder.bold(true).line('*** DUPLICATA ***').bold(false);
  encoder
    .align('left')
    .line(`N° ${receipt.number}`)
    .line(stamp(receipt.at))
    .line(`Par : ${receipt.user}`)
    .line(`Client : ${receipt.customer.name}`);
  if (receipt.customer.address) encoder.line(receipt.customer.address);
  encoder.rule();

  if (receipt.kind === 'DEBT') {
    pairs(encoder, width, [
      ['Montant payé', money(receipt.paid)],
      ['Dette restante', money(receipt.debtAfter)],
    ]);
  } else {
    for (const l of receipt.lines) {
      encoder.line(l.label);
      pairs(encoder, width, [
        [
          l.free ? `  ${l.qty} ${l.unitName}` : `  ${l.qty} ${l.unitName} x ${digits(l.unitPrice)}`,
          l.free ? 'GRATUIT' : money(l.amount),
        ],
      ]);
    }
    encoder.rule().bold(true);
    pairs(encoder, width, [['TOTAL', money(receipt.total)]]);
    encoder.bold(false);
    const rows: [string, string][] = [['Payé', money(receipt.paid)]];
    if (receipt.credit > 0) rows.push(['Reste (crédit)', money(receipt.credit)]);
    rows.push(['Dette du client', money(receipt.debtAfter)]);
    pairs(encoder, width, rows);
  }

  return encoder
    .newline()
    .align('center')
    .line('Merci de votre confiance.')
    .newline(3)
    .cut()
    .encode();
}

/** Récapitulatif de la journée (BR-PAY-07) : ce que l'agent doit verser au comptable. */
export function encodeDaySummary(summary: DaySummaryDto, ticket: TicketSettingsDto): Uint8Array {
  const width = ticket.widthMm;
  const encoder = header(encoderFor(width), ticket)
    .bold(true)
    .line('RÉCAPITULATIF DU JOUR')
    .bold(false)
    .align('left')
    .line(summary.date.split('-').reverse().join('/'))
    .line(`${summary.user.name} (${summary.user.code})`)
    .rule();
  pairs(encoder, width, [
    ['Bons', String(summary.receipts)],
    ['Total vendu', money(summary.totalSold)],
    ['Espèces des ventes', money(summary.cashSales)],
    ['Dettes encaissées', money(summary.cashDebts)],
    ['Crédit accordé', money(summary.credit)],
  ]);
  encoder.rule().bold(true);
  pairs(encoder, width, [['À VERSER', money(summary.expected)]]);
  return encoder.bold(false).newline(3).cut().encode();
}
