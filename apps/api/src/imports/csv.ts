/**
 * Lecture d'un fichier CSV exporté par Excel ou LibreOffice : UTF-8 (BOM accepté) ou, à défaut,
 * Windows-1252 ; séparateur « ; » ou « , » détecté sur la ligne d'en-tête ; guillemets doublés.
 */
export function decodeCsv(content: Buffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(content);
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  return new TextDecoder('windows-1252').decode(content);
}

export interface CsvRow {
  /** Numéro de ligne dans le fichier, en-tête compris (l'en-tête est la ligne 1). */
  line: number;
  values: Record<string, string>;
}

function splitRecords(text: string, separator: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === separator) {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/** En-têtes normalisés : minuscules, sans accents ni espaces superflus. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const records = splitRecords(text, separator);
  const [header, ...body] = records;
  const headers = (header ?? []).map(normalizeHeader);
  const rows: CsvRow[] = [];
  body.forEach((cells, index) => {
    if (cells.every((c) => c.trim() === '')) return;
    const values: Record<string, string> = {};
    headers.forEach((h, i) => {
      values[h] = (cells[i] ?? '').trim();
    });
    rows.push({ line: index + 2, values });
  });
  return { headers, rows };
}
