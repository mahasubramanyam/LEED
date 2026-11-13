/**
 * RFC 4180-Compliant CSV Parser and Escaping Utilities
 * Supports quoted fields, embedded commas, escaped quotes (""), embedded newlines, CRLF/LF, and UTF-8 BOM.
 */

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
  errors: string[];
}

export function parseCsvRfc4180(rawText: string): CsvParseResult {
  if (!rawText || typeof rawText !== 'string') {
    return { headers: [], rows: [], errors: ['CSV input is empty'] };
  }

  // Strip UTF-8 BOM if present
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const records: string[][] = [];
  const errors: string[] = [];

  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped double quote ("") inside quoted field
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      currentField += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      if (currentField.length === 0) {
        inQuotes = true;
      } else {
        // Treat stray mid-field quote leniently as literal char
        currentField += ch;
      }
      i++;
      continue;
    }

    if (ch === ',') {
      currentRow.push(currentField.trim());
      currentField = '';
      i++;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
        i += 2;
      } else {
        i++;
      }
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        records.push(currentRow);
      }
      currentRow = [];
      currentField = '';
      continue;
    }

    currentField += ch;
    i++;
  }

  if (inQuotes) {
    errors.push('Malformed CSV: unclosed double quote detected at end of file.');
  }

  // Push trailing row if non-empty
  currentRow.push(currentField.trim());
  if (currentRow.some((cell) => cell.length > 0)) {
    records.push(currentRow);
  }

  if (records.length === 0) {
    return { headers: [], rows: [], errors: [...errors, 'No CSV header or data rows detected.'] };
  }

  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1);

  return { headers, rows, errors };
}

/**
 * Escapes any cell per RFC 4180 (quotes fields containing commas, quotes, CR, or LF; doubles internal quotes).
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvDocument(headers: string[], rows: unknown[][], includeUtf8Bom = true): string {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  const content = lines.join('\r\n');
  return includeUtf8Bom ? `\uFEFF${content}` : content;
}
