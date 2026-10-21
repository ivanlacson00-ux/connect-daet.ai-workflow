'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Parsed } from '@/lib/previewParsers';

// ─── Storage ─────────────────────────────────────────────────────────────────
export const STORAGE_BUCKET = 'workflow_uploads';

export interface PreviewableFile {
  file_name: string;
  file_url: string;
  file_path?: string | null;
  file_type?: string | null;
}

// ─── Preview type detection ──────────────────────────────────────────────────
// 'document' = Word, Excel, OpenDocument, RTF and PowerPoint files that are read in the browser
// 'office'   = older .doc / .ppt files, which can't be read in the browser (download only)
export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'document' | 'office' | 'none';

export const getPreviewKind = (file: PreviewableFile): PreviewKind => {
  const name = file.file_name?.toLowerCase() || '';
  const type = file.file_type || '';
  if (type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|svg|avif|tiff?)$/.test(name)) return 'image';
  if (type.startsWith('video/') || /\.(mp4|webm|ogv|mov|m4v)$/.test(name)) return 'video';
  if (type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|oga|flac)$/.test(name)) return 'audio';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (/\.(xlsx?|ods|docx|odt|rtf|pptx|odp)$/.test(name)) return 'document';
  if (type.startsWith('text/') || /\.(csv|txt|md|json|log)$/.test(name)) return 'text';
  if (/\.(doc|ppt)$/.test(name)) return 'office';
  return 'none';
};

// ─── Find bucket + path inside storage ───────────────────────────────────────
const resolveStorage = (f: PreviewableFile): { bucket: string; path: string } | null => {
  if (f.file_path) {
    return { bucket: STORAGE_BUCKET, path: f.file_path.replace(`${STORAGE_BUCKET}/`, '') };
  }
  const m = f.file_url?.match(/\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?|$)/);
  return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null;
};

// Returns a signed URL when possible, otherwise falls back to the stored file_url
export async function getFileUrl(supabase: ReturnType<typeof createClient>, file: PreviewableFile) {
  const loc = resolveStorage(file);
  if (loc) {
    const { data, error } = await supabase.storage.from(loc.bucket).createSignedUrl(loc.path, 3600);
    if (error) console.error('Signed URL error:', error.message, loc);
    if (data?.signedUrl) return data.signedUrl;
  }
  return file.file_url;
}

export async function downloadFile(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (e) {
    console.error('Download error', e);
    window.open(url, '_blank');
  }
}

const MAX_TEXT_CHARS = 200_000;
const MAX_TABLE_ROWS = 1000;

// Small CSV parser: handles quoted fields, escaped quotes ("") and newlines inside quotes
const parseCsv = (input: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = input.replace(/^\uFEFF/, '');

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
};

const isCsvFile = (file: PreviewableFile) =>
  /\.csv$/i.test(file.file_name || '') || file.file_type === 'text/csv';

// Converted Word documents are shown in an iframe with no scripts, no network and no navigation
const wrapHtml = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">` +
  `<style>body{font:14px/1.6 system-ui,sans-serif;color:#222;padding:24px;max-width:820px;margin:0 auto}` +
  `table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}img{max-width:100%}</style>` +
  `</head><body>${body}</body></html>`;

// ─── Component ───────────────────────────────────────────────────────────────
export default function FilePreview({ file }: { file: PreviewableFile }) {
  const supabase = useMemo(() => createClient(), []);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [text, setText] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; content: string; truncated: boolean }>({
    status: 'idle',
    content: '',
    truncated: false,
  });
  const [doc, setDoc] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error' | 'toolarge'; parsed: Parsed | null }>({
    status: 'idle',
    parsed: null,
  });
  const [sheetIdx, setSheetIdx] = useState(0);

  const kind = getPreviewKind(file);

  // Get the URL for this file
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    setShowRaw(false);
    getFileUrl(supabase, file).then(u => {
      if (!cancelled) setUrl(u);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.file_path, file.file_url]);

  // Load text content
  useEffect(() => {
    if (!url || kind !== 'text') {
      setText({ status: 'idle', content: '', truncated: false });
      return;
    }
    let cancelled = false;
    setText({ status: 'loading', content: '', truncated: false });
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Fetch failed');
        const t = await res.text();
        if (cancelled) return;
        setText({ status: 'ready', content: t.slice(0, MAX_TEXT_CHARS), truncated: t.length > MAX_TEXT_CHARS });
      } catch {
        if (!cancelled) setText({ status: 'error', content: '', truncated: false });
      }
    })();
    return () => { cancelled = true; };
  }, [url, kind]);

  // Read Word / Excel / OpenDocument / RTF / PowerPoint files in the browser
  useEffect(() => {
    if (!url || kind !== 'document') {
      setDoc({ status: 'idle', parsed: null });
      return;
    }
    let cancelled = false;
    setDoc({ status: 'loading', parsed: null });
    setSheetIdx(0);
    (async () => {
      try {
        const parsers = await import('@/lib/previewParsers');
        const res = await fetch(url);
        if (!res.ok) throw new Error('Fetch failed');
        const declared = Number(res.headers.get('content-length') || 0);
        if (declared > parsers.PARSE_MAX_BYTES) {
          if (!cancelled) setDoc({ status: 'toolarge', parsed: null });
          return;
        }
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        if (buf.byteLength > parsers.PARSE_MAX_BYTES) {
          setDoc({ status: 'toolarge', parsed: null });
          return;
        }
        const ext = (file.file_name.split('.').pop() || '').toLowerCase();
        const parsed = await parsers.parseForPreview(ext, buf);
        if (!cancelled) setDoc({ status: 'ready', parsed });
      } catch (e) {
        console.error('Preview error:', e);
        if (!cancelled) setDoc({ status: 'error', parsed: null });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, kind, file.file_name]);

  const loadingView = (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      <span className="h-2 w-2 animate-pulse rounded-full bg-gray-500" /> Loading preview...
    </div>
  );

  if (!url) return loadingView;

  const fallbackMessage =
    kind === 'document' && doc.status === 'toolarge'
      ? 'This file is too large to preview here. Download it to view the full document.'
      : kind === 'document' && doc.status === 'error'
        ? 'This file could not be read for preview. It may be damaged. You can still download it.'
        : kind === 'office'
          ? "This older Word or PowerPoint format can't be shown in the browser. Download it to view the full document."
          : "This file can't be previewed here. Download it to view the full document.";

  const fallback = (
    <div className="flex h-full w-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 text-2xl text-gray-500" aria-hidden="true">▤</div>
      <p className="font-serif text-2xl text-gray-900">No preview available</p>
      <p className="mt-2 max-w-xs text-xs leading-5 text-gray-500">{fallbackMessage}</p>
      <button
        onClick={() => downloadFile(url, file.file_name)}
        className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-black px-6 text-xs font-semibold text-white transition-colors hover:bg-gray-800"
      >
        Download file
      </button>
    </div>
  );

  if (failed) return fallback;

  if (kind === 'image') {
    return (
      <img
        src={url}
        alt="Preview"
        onError={() => setFailed(true)}
        className="max-h-full max-w-full object-contain p-4 sm:p-8"
      />
    );
  }

  if (kind === 'video') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <video
          key={url}
          src={url}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
          className="max-h-full max-w-full"
        />
      </div>
    );
  }

  if (kind === 'audio') {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <audio key={url} src={url} controls onError={() => setFailed(true)} className="w-full max-w-md" />
      </div>
    );
  }

  if (kind === 'pdf') {
    return <iframe title="Document Preview" className="h-full w-full border-none" src={url} />;
  }

  if (kind === 'text') {
    if (text.status === 'idle' || text.status === 'loading') return loadingView;
    if (text.status === 'error') return fallback;

    if (isCsvFile(file) && !showRaw) {
      let rows = parseCsv(text.content);
      // If the preview was cut off, the last row is probably incomplete
      if (text.truncated && rows.length > 1) rows = rows.slice(0, -1);
      const [header, ...body] = rows;
      const shown = body.slice(0, MAX_TABLE_ROWS);
      const cut = text.truncated || body.length > MAX_TABLE_ROWS;

      return (
        <div className="flex h-full w-full flex-col">
          <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2 text-[11px] text-gray-500 sm:px-8">
            <span>{body.length} rows · {header?.length ?? 0} columns</span>
            <button onClick={() => setShowRaw(true)} className="font-semibold text-black hover:underline">
              View raw
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="min-w-full border-collapse text-left text-xs text-gray-900">
              <thead className="sticky top-0 bg-gray-100">
                <tr>
                  <th className="border-b border-gray-200 px-3 py-2 text-right font-medium text-gray-400">#</th>
                  {header?.map((h, i) => (
                    <th key={i} className="whitespace-nowrap border-b border-gray-200 px-3 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, ri) => (
                  <tr key={ri} className="odd:bg-white even:bg-gray-50">
                    <td className="border-b border-gray-100 px-3 py-2 text-right text-gray-400">{ri + 1}</td>
                    {header?.map((_, ci) => (
                      <td key={ci} className="whitespace-nowrap border-b border-gray-100 px-3 py-2">{r[ci] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cut && (
            <div className="border-t border-gray-200 bg-gray-50 px-4 py-2.5 text-[11px] text-gray-500 sm:px-8">
              Preview shortened. Download the file to see everything.
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex h-full w-full flex-col">
        {isCsvFile(file) && (
          <div className="flex items-center justify-end border-b border-gray-200 bg-gray-50 px-4 py-2 text-[11px] sm:px-8">
            <button onClick={() => setShowRaw(false)} className="font-semibold text-black hover:underline">
              View as table
            </button>
          </div>
        )}
        <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-4 text-left font-mono text-xs leading-5 text-gray-900 sm:p-8">
          {text.content}
        </pre>
        {text.truncated && (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-2.5 text-[11px] text-gray-500 sm:px-8">
            Preview shortened. Download the file to see everything.
          </div>
        )}
      </div>
    );
  }

  if (kind === 'document') {
    if (doc.status === 'idle' || doc.status === 'loading') return loadingView;
    if (doc.status !== 'ready' || !doc.parsed) return fallback;

    const parsed = doc.parsed;
    const sheet = parsed.kind === 'table' ? parsed.sheets[Math.min(sheetIdx, parsed.sheets.length - 1)] : null;

    return (
      <div className="flex h-full w-full flex-col">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-[11px] text-gray-500 sm:px-8">{parsed.note}</div>
        <div className="min-h-0 flex-1 overflow-auto">
          {parsed.kind === 'html' && (
            <iframe sandbox="" srcDoc={wrapHtml(parsed.html)} title="Document Preview" className="h-full w-full border-none bg-white" />
          )}

          {parsed.kind === 'text' && (
            <div className="mx-auto max-w-3xl p-4 text-left text-sm leading-6 text-gray-900 sm:p-8">
              {parsed.paragraphs.length === 0 && <p className="text-xs text-gray-500">No readable text found in this file.</p>}
              {parsed.paragraphs.map((p, i) => (
                <p key={i} className="mb-3 whitespace-pre-wrap break-words">{p}</p>
              ))}
            </div>
          )}

          {parsed.kind === 'slides' && (
            <div className="mx-auto max-w-3xl space-y-4 p-4 text-left sm:p-8">
              {parsed.slides.length === 0 && <p className="text-xs text-gray-500">No slides found in this file.</p>}
              {parsed.slides.map((slide, i) => (
                <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">Slide {i + 1}</p>
                  {slide.length === 0 && <p className="text-xs text-gray-500">No text on this slide.</p>}
                  {slide.map((line, j) => (
                    <p key={j} className="mb-1.5 whitespace-pre-wrap break-words text-sm text-gray-900">{line}</p>
                  ))}
                </div>
              ))}
            </div>
          )}

          {parsed.kind === 'table' && sheet && (
            <div className="text-left">
              {parsed.sheets.length > 1 && (
                <div className="flex flex-wrap gap-2 border-b border-gray-200 px-4 py-2 sm:px-8">
                  {parsed.sheets.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => setSheetIdx(i)}
                      className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                        i === sheetIdx ? 'border-black bg-black text-white' : 'border-gray-200 text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
              <table className="min-w-full border-collapse text-left text-xs text-gray-900">
                <tbody>
                  {sheet.rows.map((row, r) => (
                    <tr key={r} className={r === 0 ? 'sticky top-0 bg-gray-100 font-semibold' : 'odd:bg-white even:bg-gray-50'}>
                      {row.map((cell, c) => (
                        <td key={c} className="whitespace-nowrap border-b border-gray-100 px-3 py-2">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {sheet.truncated && (
                <div className="border-t border-gray-200 bg-gray-50 px-4 py-2.5 text-[11px] text-gray-500 sm:px-8">
                  Showing the first rows only. Download the file to see the rest.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Older .doc / .ppt files and unknown types: no safe in-browser preview
  return fallback;
}