import crypto from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { ImportWorksheetInfo, ParsedImportFileSummary } from '../types.js';

export const MAX_IMPORT_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_IMPORT_ROWS = 10_000;
export const MAX_IMPORT_COLUMNS = 150;
const MAX_XLSX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024; // 64 MB zip-bomb ceiling
const MAX_XLSX_ZIP_ENTRIES = 600;

export interface ParsedTabularData {
  summary: ParsedImportFileSummary;
  headers: string[];
  rows: string[][];
}

export class ImportFileSecurityError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, code = 'INVALID_IMPORT_FILE', statusCode = 400) {
    super(message);
    this.name = 'ImportFileSecurityError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function sanitizeImportFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    throw new ImportFileSecurityError('Filename is required.', 'MISSING_FILENAME', 400);
  }
  if (filename.includes('\0')) {
    throw new ImportFileSecurityError('Filename contains invalid null byte.', 'INVALID_FILENAME', 400);
  }
  const normalized = filename.replace(/\\/g, '/');
  if (normalized.includes('..')) {
    throw new ImportFileSecurityError('Path traversal sequences are not permitted in filename.', 'PATH_TRAVERSAL', 400);
  }
  const base = path.basename(normalized).trim();
  if (!base || base === '.' || base === '..') {
    throw new ImportFileSecurityError('Invalid filename.', 'INVALID_FILENAME', 400);
  }
  return base.slice(0, 200);
}

const ALLOWED_CSV_MIMES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/octet-stream',
  '',
]);

const ALLOWED_XLSX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  '',
]);

export function detectAndValidateFileFormat(
  filename: string,
  mimeType: string | undefined,
  buffer: Buffer
): 'csv' | 'xlsx' {
  const safeName = sanitizeImportFilename(filename);
  const ext = path.extname(safeName).toLowerCase();
  const cleanMime = (mimeType || '').split(';')[0].trim().toLowerCase();

  if (buffer.length === 0) {
    throw new ImportFileSecurityError('Uploaded file is empty.', 'EMPTY_FILE', 400);
  }
  if (buffer.length > MAX_IMPORT_FILE_BYTES) {
    throw new ImportFileSecurityError(
      `File exceeds maximum allowed upload size of ${Math.round(MAX_IMPORT_FILE_BYTES / (1024 * 1024))} MB.`,
      'FILE_TOO_LARGE',
      413
    );
  }

  // Block macro-enabled Office workbooks and executables immediately
  if (ext === '.xlsm' || ext === '.xlsb' || ext === '.xltm') {
    throw new ImportFileSecurityError(
      `Macro-enabled Excel format (${ext}) is blocked for security reasons. Export as .xlsx or .csv.`,
      'UNSAFE_MACRO_FORMAT',
      400
    );
  }

  // Detect OLE2 binary (.xls, .doc, etc.)
  const isOle2 =
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1;

  if (ext === '.xls' || isOle2) {
    throw new ImportFileSecurityError(
      'Legacy binary .xls format is not supported for security and parsing reliability reasons. Please convert to .xlsx or .csv.',
      'UNSUPPORTED_LEGACY_XLS',
      400
    );
  }

  // Detect executable / PE / ELF / Mach-O / PDF disguised payloads
  const isZipMagic =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06);
  const isPeExe = buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a; // MZ
  const isElf = buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46;
  const isPdf = buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';

  if (isPeExe || isElf || isPdf) {
    throw new ImportFileSecurityError(
      'File signature does not match an allowed spreadsheet or CSV document.',
      'INVALID_MAGIC_BYTES',
      400
    );
  }

  if (ext === '.xlsx') {
    if (!ALLOWED_XLSX_MIMES.has(cleanMime)) {
      throw new ImportFileSecurityError(
        `Unexpected MIME type "${cleanMime}" for .xlsx file.`,
        'INVALID_MIME_TYPE',
        400
      );
    }
    if (!isZipMagic) {
      throw new ImportFileSecurityError(
        'Invalid .xlsx file: missing OpenXML ZIP magic header.',
        'INVALID_MAGIC_BYTES',
        400
      );
    }
    inspectXlsxZipSafety(buffer);
    return 'xlsx';
  }

  if (ext === '.csv') {
    if (!ALLOWED_CSV_MIMES.has(cleanMime)) {
      throw new ImportFileSecurityError(
        `Unexpected MIME type "${cleanMime}" for .csv file.`,
        'INVALID_MIME_TYPE',
        400
      );
    }
    if (isZipMagic) {
      throw new ImportFileSecurityError(
        'File has .csv extension but contains a binary ZIP archive.',
        'EXTENSION_MISMATCH',
        400
      );
    }
    return 'csv';
  }

  throw new ImportFileSecurityError(
    `Unsupported file extension "${ext || '(none)'}". Supported formats: .csv and .xlsx.`,
    'UNSUPPORTED_FORMAT',
    400
  );
}

/**
 * Inspects Central Directory / Local File Headers in an OOXML ZIP buffer to reject
 * macro streams (vbaProject.bin) and zip bombs before ExcelJS inflates XML.
 */
export function inspectXlsxZipSafety(buffer: Buffer): void {
  // Scan End of Central Directory (PK\x05\x06) from the end of buffer
  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset >= 0) {
    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const cdSize = buffer.readUInt32LE(eocdOffset + 12);
    const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

    if (totalEntries > MAX_XLSX_ZIP_ENTRIES) {
      throw new ImportFileSecurityError(
        `XLSX archive contains too many entries (${totalEntries} > ${MAX_XLSX_ZIP_ENTRIES}).`,
        'ZIP_BOMB_ENTRIES',
        400
      );
    }

    let cursor = cdOffset;
    let totalUncompressed = 0;
    let scanned = 0;
    const cdEnd = Math.min(buffer.length, cdOffset + cdSize);

    while (cursor + 46 <= cdEnd && scanned < totalEntries) {
      if (
        buffer[cursor] !== 0x50 ||
        buffer[cursor + 1] !== 0x4b ||
        buffer[cursor + 2] !== 0x01 ||
        buffer[cursor + 3] !== 0x02
      ) {
        break;
      }
      const compressedSize = buffer.readUInt32LE(cursor + 20);
      const uncompressedSize = buffer.readUInt32LE(cursor + 24);
      const nameLen = buffer.readUInt16LE(cursor + 28);
      const extraLen = buffer.readUInt16LE(cursor + 30);
      const commentLen = buffer.readUInt16LE(cursor + 32);

      const entryName = buffer
        .subarray(cursor + 46, Math.min(cdEnd, cursor + 46 + nameLen))
        .toString('utf8')
        .toLowerCase();

      if (entryName.includes('vbaproject') || entryName.endsWith('.bin')) {
        throw new ImportFileSecurityError(
          'Workbook contains embedded VBA/binary macro stream (vbaProject.bin) and was rejected.',
          'UNSAFE_MACRO_STREAM',
          400
        );
      }

      if (uncompressedSize > MAX_XLSX_UNCOMPRESSED_BYTES) {
        throw new ImportFileSecurityError(
          'XLSX entry exceeds safe uncompressed size limit.',
          'ZIP_BOMB_SIZE',
          400
        );
      }
      if (compressedSize > 0 && uncompressedSize / compressedSize > 150 && uncompressedSize > 5_000_000) {
        throw new ImportFileSecurityError(
          'XLSX compression ratio exceeds safe decompression threshold.',
          'ZIP_BOMB_RATIO',
          400
        );
      }

      totalUncompressed += uncompressedSize;
      if (totalUncompressed > MAX_XLSX_UNCOMPRESSED_BYTES) {
        throw new ImportFileSecurityError(
          'Total uncompressed XLSX contents exceed safe memory limits (64 MB).',
          'ZIP_BOMB_TOTAL',
          400
        );
      }

      cursor += 46 + nameLen + extraLen + commentLen;
      scanned++;
    }
  }
}

export function decodeCsvBuffer(buffer: Buffer): { text: string; encoding: string } {
  // Check UTF-16LE / UTF-16BE / UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'UTF-8-BOM' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString('utf16le'), encoding: 'UTF-16LE' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    // Swap byte order for UTF-16BE -> LE
    const swapped = Buffer.allocUnsafe(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1];
      swapped[i - 1] = buffer[i];
    }
    return { text: swapped.toString('utf16le'), encoding: 'UTF-16BE' };
  }

  // Reject NUL bytes in non-UTF-16 files (binary file masquerading as CSV)
  const sampleLen = Math.min(buffer.length, 8192);
  for (let i = 0; i < sampleLen; i++) {
    if (buffer[i] === 0x00) {
      throw new ImportFileSecurityError(
        'CSV contains null binary bytes and is not a valid text file.',
        'BINARY_IN_CSV',
        400
      );
    }
  }

  // Strict UTF-8 check using TextDecoder(fatal: true)
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return { text: decoder.decode(buffer), encoding: 'UTF-8' };
  } catch {
    // Fallback to Windows-1252 / ISO-8859-1 safely
    try {
      const winDecoder = new TextDecoder('windows-1252');
      return { text: winDecoder.decode(buffer), encoding: 'Windows-1252 / ISO-8859-1' };
    } catch {
      return { text: buffer.toString('latin1'), encoding: 'ISO-8859-1' };
    }
  }
}

function detectCsvDelimiter(text: string): ',' | ';' | '\t' | '|' {
  // Inspect first non-empty line outside quotes
  const firstLineEnd = text.search(/\r?\n/);
  const firstLine = firstLineEnd >= 0 ? text.slice(0, firstLineEnd) : text;
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === ',' || ch === ';' || ch === '\t' || ch === '|')) {
      counts[ch]++;
    }
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  if (counts['|'] > counts[','] && counts['|'] > counts[';']) return '|';
  return ',';
}

export function parseCsvWithDelimiter(rawText: string): {
  headers: string[];
  rows: string[][];
  delimiter: string;
  errors: string[];
  warnings: string[];
} {
  const cleanText = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const delimiter = detectCsvDelimiter(cleanText);
  const records: string[][] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < cleanText.length) {
    const ch = cleanText[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < cleanText.length && cleanText[i + 1] === '"') {
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
        currentField += ch;
      }
      i++;
      continue;
    }

    if (ch === delimiter) {
      currentRow.push(currentField.trim());
      currentField = '';
      i++;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && i + 1 < cleanText.length && cleanText[i + 1] === '\n') {
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

  currentRow.push(currentField.trim());
  if (currentRow.some((cell) => cell.length > 0)) {
    records.push(currentRow);
  }

  if (records.length === 0) {
    return {
      headers: [],
      rows: [],
      delimiter,
      errors: [...errors, 'No header or data rows detected in CSV.'],
      warnings,
    };
  }

  const rawHeaders = records[0];
  if (rawHeaders.length > MAX_IMPORT_COLUMNS) {
    throw new ImportFileSecurityError(
      `File contains ${rawHeaders.length} columns, exceeding maximum allowed limit of ${MAX_IMPORT_COLUMNS}.`,
      'TOO_MANY_COLUMNS',
      400
    );
  }

  const { headers, headerWarnings } = normalizeHeaders(rawHeaders);
  warnings.push(...headerWarnings);

  const rawRows = records.slice(1);
  if (rawRows.length > MAX_IMPORT_ROWS) {
    throw new ImportFileSecurityError(
      `File contains ${rawRows.length} data rows, exceeding the maximum allowed limit of ${MAX_IMPORT_ROWS} rows per import.`,
      'TOO_MANY_ROWS',
      400
    );
  }

  // Align ragged rows cleanly with warning
  let raggedCount = 0;
  const rows = rawRows.map((r) => {
    if (r.length !== headers.length) raggedCount++;
    const normalized = new Array<string>(headers.length);
    for (let c = 0; c < headers.length; c++) {
      normalized[c] = (r[c] ?? '').trim();
    }
    return normalized;
  });

  if (raggedCount > 0) {
    warnings.push(`${raggedCount} row(s) had extra or missing columns and were aligned to the ${headers.length}-column header schema.`);
  }

  return { headers, rows, delimiter, errors, warnings };
}

function normalizeHeaders(rawHeaders: string[]): { headers: string[]; headerWarnings: string[] } {
  const seen = new Map<string, number>();
  const headerWarnings: string[] = [];
  let blankIndex = 1;

  const headers = rawHeaders.map((h) => {
    const trimmed = (h || '').trim().replace(/\s+/g, ' ');
    let base = trimmed;
    if (!base) {
      base = `Column ${blankIndex++}`;
      headerWarnings.push(`Blank column header detected; assigned fallback header "${base}".`);
    }
    const lower = base.toLowerCase();
    const count = (seen.get(lower) || 0) + 1;
    seen.set(lower, count);
    if (count > 1) {
      const disambiguated = `${base} (${count})`;
      headerWarnings.push(`Duplicate column header "${base}" disambiguated as "${disambiguated}".`);
      return disambiguated;
    }
    return base;
  });

  return { headers, headerWarnings };
}

/**
 * Safely extracts text from an ExcelJS cell value without ever evaluating formulas.
 */
function extractSafeExcelCellText(value: ExcelJS.CellValue, warnings: Set<string>): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    const iso = value.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (typeof value === 'object') {
    const obj = value as unknown as Record<string, unknown>;
    // Formula cell: NEVER execute formula, only inspect static cached result if present
    if ('formula' in obj || 'sharedFormula' in obj) {
      if ('result' in obj && obj.result !== undefined && obj.result !== null) {
        if (typeof obj.result === 'object' && obj.result !== null && 'error' in (obj.result as Record<string, unknown>)) {
          warnings.add('Workbook contained formula error values (e.g. #REF!/#VALUE!); treated as blank without formula execution.');
          return '';
        }
        return extractSafeExcelCellText(obj.result as ExcelJS.CellValue, warnings);
      }
      warnings.add('Workbook contained uncached formula cells; formulas are never evaluated for security.');
      return '';
    }
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return obj.richText
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('')
        .trim();
    }
    if ('hyperlink' in obj) {
      const textPart = typeof obj.text === 'string' ? obj.text.trim() : '';
      const linkPart = typeof obj.hyperlink === 'string' ? obj.hyperlink.trim() : '';
      return textPart || linkPart;
    }
    if ('text' in obj && typeof obj.text === 'string') {
      return obj.text.trim();
    }
    if ('error' in obj) {
      warnings.add('Workbook contained Excel cell error values; treated as blank.');
      return '';
    }
  }
  return String(value).trim();
}

export async function parseImportFileBuffer(options: {
  filename: string;
  mimeType?: string;
  buffer: Buffer;
  worksheetName?: string;
}): Promise<ParsedTabularData> {
  const safeName = sanitizeImportFilename(options.filename);
  const format = detectAndValidateFileFormat(safeName, options.mimeType, options.buffer);
  const sha256 = crypto.createHash('sha256').update(options.buffer).digest('hex');

  if (format === 'csv') {
    const { text, encoding } = decodeCsvBuffer(options.buffer);
    const parsed = parseCsvWithDelimiter(text);
    if (parsed.errors.length > 0) {
      throw new ImportFileSecurityError(parsed.errors.join(' '), 'CSV_PARSE_ERROR', 400);
    }
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      throw new ImportFileSecurityError(
        'CSV file must include a header row and at least one non-empty data row.',
        'EMPTY_DATA_ROWS',
        400
      );
    }

    return {
      summary: {
        filename: safeName,
        format: 'csv',
        fileSizeBytes: options.buffer.length,
        fileSha256: sha256,
        encodingDetected: encoding,
        delimiterDetected: parsed.delimiter === '\t' ? 'TAB' : parsed.delimiter,
        worksheets: [{ name: 'CSV', rowCount: parsed.rows.length, columnCount: parsed.headers.length }],
        selectedWorksheet: 'CSV',
        headers: parsed.headers,
        totalRows: parsed.rows.length,
        truncated: false,
        warnings: parsed.warnings,
      },
      headers: parsed.headers,
      rows: parsed.rows,
    };
  }

  // XLSX parsing via ExcelJS (no formula execution, no temp file persistence)
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(options.buffer as unknown as ArrayBuffer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ImportFileSecurityError(`Failed to parse .xlsx workbook: ${msg}`, 'XLSX_PARSE_ERROR', 400);
  }

  const sheetSummaries: ImportWorksheetInfo[] = workbook.worksheets.map((ws) => ({
    name: ws.name,
    rowCount: Math.max(0, ws.actualRowCount - 1),
    columnCount: ws.actualColumnCount,
  }));

  if (sheetSummaries.length === 0) {
    throw new ImportFileSecurityError('Excel workbook contains no worksheets.', 'EMPTY_WORKBOOK', 400);
  }

  let selectedWs = options.worksheetName
    ? workbook.getWorksheet(options.worksheetName)
    : workbook.worksheets.find((w) => w.actualRowCount > 1) || workbook.worksheets[0];

  if (!selectedWs) {
    throw new ImportFileSecurityError(
      `Worksheet "${options.worksheetName}" not found in workbook.`,
      'WORKSHEET_NOT_FOUND',
      400
    );
  }

  const warnings = new Set<string>();
  const rawTable: string[][] = [];
  let maxCols = 0;

  selectedWs.eachRow({ includeEmpty: false }, (row) => {
    const colCount = Math.min(MAX_IMPORT_COLUMNS + 1, Math.max(row.cellCount, row.actualCellCount));
    if (colCount > MAX_IMPORT_COLUMNS) {
      throw new ImportFileSecurityError(
        `Worksheet "${selectedWs!.name}" exceeds maximum column limit of ${MAX_IMPORT_COLUMNS}.`,
        'TOO_MANY_COLUMNS',
        400
      );
    }
    const rowCells: string[] = [];
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      rowCells.push(extractSafeExcelCellText(cell.value, warnings));
    }
    if (rowCells.some((val) => val.length > 0)) {
      maxCols = Math.max(maxCols, rowCells.length);
      rawTable.push(rowCells);
    }
  });

  if (rawTable.length < 2) {
    throw new ImportFileSecurityError(
      `Worksheet "${selectedWs.name}" must include a header row and at least one non-empty data row.`,
      'EMPTY_DATA_ROWS',
      400
    );
  }

  const paddedHeaderRow = new Array<string>(maxCols).fill('').map((_, idx) => rawTable[0][idx] ?? '');
  const { headers, headerWarnings } = normalizeHeaders(paddedHeaderRow);
  for (const w of headerWarnings) warnings.add(w);

  const dataSlice = rawTable.slice(1);
  if (dataSlice.length > MAX_IMPORT_ROWS) {
    throw new ImportFileSecurityError(
      `Worksheet "${selectedWs.name}" contains ${dataSlice.length} data rows, exceeding the maximum allowed limit of ${MAX_IMPORT_ROWS}.`,
      'TOO_MANY_ROWS',
      400
    );
  }

  const rows = dataSlice.map((r) => {
    const aligned = new Array<string>(headers.length);
    for (let c = 0; c < headers.length; c++) {
      aligned[c] = (r[c] ?? '').trim();
    }
    return aligned;
  });

  return {
    summary: {
      filename: safeName,
      format: 'xlsx',
      fileSizeBytes: options.buffer.length,
      fileSha256: sha256,
      encodingDetected: 'OpenXML UTF-8',
      worksheets: sheetSummaries,
      selectedWorksheet: selectedWs.name,
      headers,
      totalRows: rows.length,
      truncated: false,
      warnings: Array.from(warnings),
    },
    headers,
    rows,
  };
}

export function getUploadGuardConfig() {
  return {
    maxBytes: MAX_IMPORT_FILE_BYTES,
    maxRows: MAX_IMPORT_ROWS,
    maxColumns: MAX_IMPORT_COLUMNS,
    maxXlsxUncompressedBytes: MAX_XLSX_UNCOMPRESSED_BYTES,
    maxXlsxZipEntries: MAX_XLSX_ZIP_ENTRIES,
    magicByteAndMacroScan:
      typeof detectAndValidateFileFormat === 'function' &&
      MAX_XLSX_UNCOMPRESSED_BYTES > 0 &&
      MAX_XLSX_ZIP_ENTRIES > 0,
  };
}
