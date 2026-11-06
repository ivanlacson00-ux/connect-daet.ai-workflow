// Save as: lib/previewParsers.ts
// Turns a file into something safe to show. Everything is rendered as text or inside
// a locked-down iframe, so nothing inside a document can run code.

import { unzipSync, strFromU8 } from 'fflate';

export type Parsed =
  | { kind: 'html'; html: string; note: string }
  | { kind: 'text'; paragraphs: string[]; note: string }
  | { kind: 'table'; sheets: { name: string; rows: string[][]; truncated: boolean }[]; note: string }
  | { kind: 'slides'; slides: string[][]; note: string };

export const PARSE_MAX_BYTES = 10 * 1024 * 1024; // larger files get the download fallback
const MAX_ROWS = 200;
const MAX_COLS = 40;
const MAX_SHEETS = 10;
const MAX_SLIDES = 100;
const MAX_PARAGRAPHS = 2000;
const ZIP_ENTRY_MAX = 10 * 1024 * 1024; // refuse to inflate any single entry above this (zip bombs)

const NS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const NS_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const NS_DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function unzipEntries(buf: ArrayBuffer, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(buf), { filter: (f) => wanted(f.name) && f.originalSize <= ZIP_ENTRY_MAX });
}

function parseXml(bytes: Uint8Array): Document {
  const doc = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Unreadable XML');
  return doc;
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
  } catch {
    return new TextDecoder('windows-1252').decode(bytes); // Excel's default CSV encoding
  }
}

export function parseCsv(raw: string): Parsed {
  const t = raw.replace(/^\uFEFF/, '');
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ',');

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let truncated = false;
  let stopped = false;

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
      if (rows.length >= MAX_ROWS) { truncated = i < t.length - 1; stopped = true; break; }
    } else cell += c;
  }
  if (!stopped && (cell !== '' || row.length)) { row.push(cell); rows.push(row); }

  return {
    kind: 'table',
    sheets: [{ name: 'CSV', rows: rows.map((r) => r.slice(0, MAX_COLS)), truncated }],
    note: 'Values are shown as plain text. Download the original to see everything.',
  };
}

// ─── Spreadsheets (xlsx, xls, ods) ───────────────────────────────────────────

export async function parseSpreadsheet(buf: ArrayBuffer): Promise<Parsed> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array', sheetRows: MAX_ROWS + 1, cellFormula: false, cellHTML: false, cellStyles: false });
  const sheets = wb.SheetNames.slice(0, MAX_SHEETS).map((name) => {
    const data = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    return {
      name,
      rows: data.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map((c) => String(c ?? ''))),
      truncated: data.length > MAX_ROWS,
    };
  });
  return {
    kind: 'table',
    sheets,
    note: 'Values are shown as plain text. Formulas, charts and formatting are not shown.',
  };
}

// ─── Word (docx) ─────────────────────────────────────────────────────────────

export async function parseDocx(buf: ArrayBuffer): Promise<Parsed> {
  const mod = await import('mammoth');
  const mammoth = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  return {
    kind: 'html',
    html: result.value,
    note: 'Simplified preview. Page layout, headers and some formatting are not shown.',
  };
}

// ─── OpenDocument (odt, odp) ─────────────────────────────────────────────────

function odfText(node: Node): string {
  let out = '';
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.nodeValue ?? '';
    else if (n.nodeType === 1) {
      const el = n as Element;
      if (el.namespaceURI === NS_TEXT && el.localName === 's') {
        out += ' '.repeat(Math.min(parseInt(el.getAttributeNS(NS_TEXT, 'c') || '1', 10) || 1, 50));
      } else if (el.namespaceURI === NS_TEXT && el.localName === 'tab') out += '\t';
      else if (el.namespaceURI === NS_TEXT && el.localName === 'line-break') out += '\n';
      else out += odfText(el);
    }
  });
  return out;
}

function collectOdfParagraphs(node: Node, out: string[]) {
  node.childNodes.forEach((n) => {
    if (n.nodeType !== 1 || out.length >= MAX_PARAGRAPHS) return;
    const el = n as Element;
    if (el.namespaceURI === NS_TEXT && (el.localName === 'p' || el.localName === 'h')) {
      const t = odfText(el).trim();
      if (t) out.push(t);
    } else collectOdfParagraphs(el, out);
  });
}

function odfContent(buf: ArrayBuffer): Document {
  const files = unzipEntries(buf, (n) => n === 'content.xml');
  if (!files['content.xml']) throw new Error('No content.xml');
  return parseXml(files['content.xml']);
}

export function parseOdt(buf: ArrayBuffer): Parsed {
  const doc = odfContent(buf);
  const body = doc.getElementsByTagNameNS(NS_OFFICE, 'text')[0];
  const paragraphs: string[] = [];
  if (body) collectOdfParagraphs(body, paragraphs);
  return { kind: 'text', paragraphs, note: 'Text-only preview. Layout, tables and images are not shown.' };
}

export function parseOdp(buf: ArrayBuffer): Parsed {
  const doc = odfContent(buf);
  const slides: string[][] = [];
  Array.from(doc.getElementsByTagNameNS(NS_DRAW, 'page')).slice(0, MAX_SLIDES).forEach((page) => {
    const paragraphs: string[] = [];
    collectOdfParagraphs(page, paragraphs);
    slides.push(paragraphs);
  });
  return { kind: 'slides', slides, note: 'Text-only preview. Images, shapes and layout are not shown.' };
}

// ─── PowerPoint (pptx) ───────────────────────────────────────────────────────

export function parsePptx(buf: ArrayBuffer): Parsed {
  const files = unzipEntries(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const num = (n: string) => parseInt(n.replace(/\D/g, ''), 10);
  const names = Object.keys(files).sort((a, b) => num(a) - num(b)).slice(0, MAX_SLIDES);
  const slides = names.map((name) => {
    const doc = parseXml(files[name]);
    const out: string[] = [];
    Array.from(doc.getElementsByTagNameNS(NS_A, 'p')).forEach((p) => {
      const text = Array.from(p.getElementsByTagNameNS(NS_A, 't')).map((t) => t.textContent ?? '').join('').trim();
      if (text) out.push(text);
    });
    return out;
  });
  return { kind: 'slides', slides, note: 'Text-only preview. Images, shapes and layout are not shown.' };
}

// ─── Rich Text (rtf) ─────────────────────────────────────────────────────────

const RTF_SKIP = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'footnote',
  'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'listtable', 'listoverridetable',
  'rsidtbl', 'generator', 'xmlnstbl', 'fldinst',
]);
const RTF_CHARS: Record<string, string> = {
  emdash: '\u2014', endash: '\u2013', bullet: '\u2022', lquote: '\u2018', rquote: '\u2019',
  ldblquote: '\u201c', rdblquote: '\u201d',
};

export function parseRtf(bytes: Uint8Array): Parsed {
  const s = new TextDecoder('latin1').decode(bytes);
  const cp1252 = new TextDecoder('windows-1252');
  const out: string[] = [];
  const stack: boolean[] = [];
  let skip = false;
  let uc = 1;
  let i = 0;

  while (i < s.length && out.length < 400_000) {
    const c = s[i];
    if (c === '{') {
      stack.push(skip);
      i++;
      if (s[i] === '\\' && s[i + 1] === '*') skip = true;
      else if (s[i] === '\\') {
        const m = /^\\([a-zA-Z]+)/.exec(s.slice(i, i + 24));
        if (m && RTF_SKIP.has(m[1].toLowerCase())) skip = true;
      }
      continue;
    }
    if (c === '}') { skip = stack.pop() ?? false; i++; continue; }
    if (c === '\\') {
      const n = s[i + 1];
      if (n === "'") {
        if (!skip) out.push(cp1252.decode(new Uint8Array([parseInt(s.slice(i + 2, i + 4), 16) || 63])));
        i += 4; continue;
      }
      if (n === '\\' || n === '{' || n === '}') { if (!skip) out.push(n); i += 2; continue; }
      if (n === '~') { if (!skip) out.push('\u00a0'); i += 2; continue; }
      if (n === '_') { if (!skip) out.push('-'); i += 2; continue; }
      if (n === '-' || n === '*' || n === '|' || n === ':') { i += 2; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i, i + 40));
      if (!m) { i += 2; continue; }
      const word = m[1].toLowerCase();
      const param = m[2] !== undefined ? parseInt(m[2], 10) : undefined;
      i += m[0].length;
      if (skip) continue;
      if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') out.push('\n');
      else if (word === 'tab') out.push('\t');
      else if (RTF_CHARS[word]) out.push(RTF_CHARS[word]);
      else if (word === 'uc' && param !== undefined) uc = Math.max(0, param);
      else if (word === 'u' && param !== undefined) {
        out.push(String.fromCharCode(param < 0 ? param + 65536 : param));
        for (let k = 0; k < uc; k++) {
          if (s[i] === '\\' && s[i + 1] === "'") i += 4;
          else i++;
        }
      }
      continue;
    }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (!skip) out.push(c);
    i++;
  }

  const paragraphs = out.join('').split(/\n+/).map((p) => p.trim()).filter(Boolean).slice(0, MAX_PARAGRAPHS);
  return { kind: 'text', paragraphs, note: 'Text-only preview. Formatting, tables and images are not shown.' };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export const PARSEABLE = new Set(['csv', 'xls', 'xlsx', 'ods', 'docx', 'odt', 'rtf', 'pptx', 'odp']);

export async function parseForPreview(ext: string, buf: ArrayBuffer): Promise<Parsed> {
  switch (ext) {
    case 'csv':
      return parseCsv(decodeText(new Uint8Array(buf, 0, Math.min(buf.byteLength, 2 * 1024 * 1024))));
    case 'xls':
    case 'xlsx':
    case 'ods':
      return parseSpreadsheet(buf);
    case 'docx':
      return parseDocx(buf);
    case 'odt':
      return parseOdt(buf);
    case 'odp':
      return parseOdp(buf);
    case 'pptx':
      return parsePptx(buf);
    case 'rtf':
      return parseRtf(new Uint8Array(buf));
    default:
      throw new Error('No previewer for this type');
  }
}