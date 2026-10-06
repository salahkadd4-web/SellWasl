/**
 * Une cellule de CSV : un texte qui commence comme une formule (=, +, -, @, tabulation) est
 * précédé d'une apostrophe pour qu'Excel l'affiche sans l'exécuter ; guillemets doublés.
 */
export const cell = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Marque UTF-8 en tête de fichier : Excel reconnaît alors les accents. */
const BOM = String.fromCharCode(0xfeff);

/** Plafond d'un export (BR-IO-03). */
export const MAX_EXPORT_ROWS = 100_000;

/**
 * Fichier CSV lisible par Excel en français : séparateur « ; », UTF-8 avec BOM, 100 000 lignes au
 * plus.
 */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = rows.slice(0, MAX_EXPORT_ROWS).map((r) => r.map(cell).join(';'));
  return `${BOM}${[header.map(cell).join(';'), ...lines].join('\n')}\n`;
}
