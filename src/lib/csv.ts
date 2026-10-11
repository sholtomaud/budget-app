/** RFC 4180 CSV, read and write (ADR 0003). */

/** Parse CSV text into rows of fields. Handles quotes, escaped quotes, CRLF, and a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let sawAny = false;
  for (; i < text.length; i++) {
    const c = text[i]!;
    sawAny = true;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      sawAny = false;
    } else field += c;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (sawAny || field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function quote(field: string): string {
  return /[",\r\n]/.test(field) || /^\s|\s$/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/** Serialise rows as CSV with CRLF line endings (RFC 4180). */
export function writeCsv(
  rows: readonly (readonly (string | number | null | undefined)[])[]
): string {
  return (
    rows
      .map((r) => r.map((f) => quote(f === null || f === undefined ? '' : String(f))).join(','))
      .join('\r\n') + '\r\n'
  );
}
