// Save as: lib/uploadRules.ts
// Shared upload rules for every upload entry point (new submissions, revisions, evidence).

import { unzipSync, strFromU8 } from 'fflate';

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB. Keep in sync with migration 4.

type Rule = { canonical: string; mimes: string[]; label: string };

const OOXML = 'application/vnd.openxmlformats-officedocument';
const ODF = 'application/vnd.oasis.opendocument';

export const FILE_RULES: Record<string, Rule> = {
  pdf: { canonical: 'application/pdf', mimes: ['application/pdf'], label: 'PDF document' },
  doc: { canonical: 'application/msword', mimes: ['application/msword'], label: 'Word document (.doc)' },
  docx: {
    canonical: `${OOXML}.wordprocessingml.document`,
    mimes: [`${OOXML}.wordprocessingml.document`],
    label: 'Word document',
  },
  odt: { canonical: `${ODF}.text`, mimes: [`${ODF}.text`], label: 'OpenDocument text' },
  rtf: {
    canonical: 'application/rtf',
    mimes: ['application/rtf', 'text/rtf', 'application/x-rtf', 'text/richtext'],
    label: 'Rich Text document',
  },
  xls: {
    canonical: 'application/vnd.ms-excel',
    mimes: ['application/vnd.ms-excel', 'application/msexcel', 'application/x-msexcel'],
    label: 'Excel spreadsheet (.xls)',
  },
  xlsx: {
    canonical: `${OOXML}.spreadsheetml.sheet`,
    mimes: [`${OOXML}.spreadsheetml.sheet`],
    label: 'Excel spreadsheet',
  },
  csv: {
    // Windows with Excel installed often reports CSV as application/vnd.ms-excel
    canonical: 'text/csv',
    mimes: ['text/csv', 'application/csv', 'text/x-csv', 'application/x-csv', 'text/plain', 'application/vnd.ms-excel'],
    label: 'CSV file',
  },
  ods: { canonical: `${ODF}.spreadsheet`, mimes: [`${ODF}.spreadsheet`], label: 'OpenDocument spreadsheet' },
  ppt: {
    canonical: 'application/vnd.ms-powerpoint',
    mimes: ['application/vnd.ms-powerpoint', 'application/mspowerpoint'],
    label: 'PowerPoint presentation (.ppt)',
  },
  pptx: {
    canonical: `${OOXML}.presentationml.presentation`,
    mimes: [`${OOXML}.presentationml.presentation`],
    label: 'PowerPoint presentation',
  },
  odp: { canonical: `${ODF}.presentation`, mimes: [`${ODF}.presentation`], label: 'OpenDocument presentation' },
  jpg: { canonical: 'image/jpeg', mimes: ['image/jpeg', 'image/pjpeg'], label: 'JPEG image' },
  jpeg: { canonical: 'image/jpeg', mimes: ['image/jpeg', 'image/pjpeg'], label: 'JPEG image' },
  png: { canonical: 'image/png', mimes: ['image/png'], label: 'PNG image' },
  tif: { canonical: 'image/tiff', mimes: ['image/tiff', 'image/x-tiff'], label: 'TIFF scan' },
  tiff: { canonical: 'image/tiff', mimes: ['image/tiff', 'image/x-tiff'], label: 'TIFF scan' },
};

export const ACCEPT_ATTR = Object.keys(FILE_RULES).map((e) => `.${e}`).join(',');
export const SUPPORTED_TEXT = 'PDF, Word, ODT, RTF, Excel, CSV, ODS, PowerPoint, ODP, JPG, PNG or TIFF';
export const ALLOWED_MIME_TYPES = Array.from(new Set(Object.values(FILE_RULES).map((r) => r.canonical)));

export function getExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}
export const typeLabel = (ext: string) => FILE_RULES[ext]?.label ?? 'File';
export const mimeForExtension = (ext: string) => FILE_RULES[ext]?.canonical ?? 'application/octet-stream';
export const isWebImage = (ext: string) => ext === 'jpg' || ext === 'jpeg' || ext === 'png';

export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

export type FileCheck = { ok: true; ext: string; mime: string } | { ok: false; error: string };

// ─── Content checks ──────────────────────────────────────────────────────────

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

function hasUtf16(bytes: Uint8Array, text: string): boolean {
  const pat = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) pat[i * 2] = text.charCodeAt(i);
  outer: for (let i = 0; i <= bytes.length - pat.length; i++) {
    if (bytes[i] !== pat[0]) continue;
    for (let j = 1; j < pat.length; j++) if (bytes[i + j] !== pat[j]) continue outer;
    return true;
  }
  return false;
}

// Office and OpenDocument files are ZIP archives. Reading the archive's entry list (without
// unpacking anything) shows what the file really is and avoids zip bombs.
async function zipInfo(file: File): Promise<{ names: string[]; mimetype: string | null } | null> {
  try {
    const names: string[] = [];
    const found = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => {
        names.push(f.name);
        return f.name === 'mimetype' && f.originalSize < 256;
      },
    });
    return { names, mimetype: found['mimetype'] ? strFromU8(found['mimetype']).trim() : null };
  } catch {
    return null; // not a readable ZIP archive
  }
}

function looksLikeText(head: Uint8Array): boolean {
  // Plain text only: no NUL bytes and no control characters other than tab, CR, LF
  for (const b of head) if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) return false;
  // Not another known format under a .csv name
  const sigs = [[0x4d, 0x5a], [0x7f, 0x45, 0x4c, 0x46], [0x25, 0x50, 0x44, 0x46], [0x50, 0x4b], [0xff, 0xd8, 0xff], OLE2];
  return !sigs.some((s) => startsWith(head, s));
}

async function contentError(file: File, ext: string): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 160).arrayBuffer());
  switch (ext) {
    case 'pdf':
      return startsWith(head, [0x25, 0x50, 0x44, 0x46]) ? null : 'is not a valid PDF';
    case 'jpg':
    case 'jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]) ? null : 'is not a valid JPEG image';
    case 'png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? null : 'is not a valid PNG image';
    case 'tif':
    case 'tiff':
      return startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])
        ? null
        : 'is not a valid TIFF image';
    case 'rtf':
      return startsWith(head, [0x7b, 0x5c, 0x72, 0x74, 0x66]) ? null : 'is not a valid RTF document';
    case 'csv':
      return looksLikeText(head) && looksLikeText(new Uint8Array(await file.slice(0, 65536).arrayBuffer()))
        ? null
        : 'does not look like a CSV text file';
    case 'doc':
    case 'xls':
    case 'ppt': {
      if (!startsWith(head, OLE2)) return `is not a valid .${ext} file`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ok =
        ext === 'doc'
          ? hasUtf16(bytes, 'WordDocument')
          : ext === 'xls'
            ? hasUtf16(bytes, 'Workbook') || hasUtf16(bytes, 'Book')
            : hasUtf16(bytes, 'PowerPoint Document');
      return ok ? null : `has contents that do not match a .${ext} file`;
    }
    case 'docx':
    case 'xlsx':
    case 'pptx': {
      if (!startsWith(head, ZIP)) return `is not a valid .${ext} file`;
      const info = await zipInfo(file);
      if (!info) return `is not a valid .${ext} file`;
      const marker = ext === 'docx' ? 'word/' : ext === 'xlsx' ? 'xl/' : 'ppt/';
      if (!info.names.some((n) => n.startsWith(marker))) return `has contents that do not match a .${ext} file`;
      if (info.names.some((n) => n.toLowerCase().endsWith('vbaproject.bin'))) return 'contains macros, which are not allowed';
      return null;
    }
    case 'odt':
    case 'ods':
    case 'odp': {
      if (!startsWith(head, ZIP)) return `is not a valid .${ext} file`;
      const info = await zipInfo(file);
      return info && info.mimetype === FILE_RULES[ext].canonical && info.names.includes('content.xml')
        ? null
        : `is not a valid .${ext} file`;
    }
    default:
      return 'is not a supported file type';
  }
}

export async function validateUploadFile(file: File): Promise<FileCheck> {
  const ext = getExtension(file.name);
  const rule = FILE_RULES[ext];

  if (!rule) {
    return { ok: false, error: `"${file.name}" is not a supported file type. Upload a ${SUPPORTED_TEXT} file.` };
  }
  if (file.size === 0) {
    return { ok: false, error: `"${file.name}" is empty. Choose a file that has content.` };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `"${file.name}" is ${formatSize(file.size)}. The limit is ${formatSize(MAX_FILE_BYTES)} per file.`,
    };
  }
  // Browsers and operating systems report different types for the same valid file, so an empty
  // or generic type is tolerated. A specific but wrong type is a mismatch. The real check is the content.
  const declared = file.type.toLowerCase();
  if (declared && declared !== 'application/octet-stream' && !rule.mimes.includes(declared)) {
    return { ok: false, error: `"${file.name}" does not match its .${ext} extension. Choose a genuine .${ext} file.` };
  }

  const problem = await contentError(file, ext);
  if (problem) {
    return { ok: false, error: `"${file.name}" ${problem}. Its contents do not match its extension.` };
  }

  return { ok: true, ext, mime: rule.canonical };
}