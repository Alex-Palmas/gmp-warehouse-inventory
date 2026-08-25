/**
 * Screenshot / barcode evidence for sandbox OQ. Failures are swallowed so jsdom
 * tests stay fast; the browser run must produce data URLs.
 */
import JsBarcode from 'jsbarcode';

export interface OqImage {
  caption: string;
  dataUrl: string;
}

function isJsdom(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
}

function canDrawCanvas(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext && c.getContext('2d'));
  } catch {
    return false;
  }
}

export function captureBarcode(serial: string, caption?: string): OqImage | null {
  if (!serial || isJsdom() || !canDrawCanvas()) return null;
  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, serial, {
      format: 'CODE128',
      displayValue: true,
      fontSize: 12,
      height: 48,
      margin: 8,
      width: 1.4,
    });
    return { caption: caption || `CODE128 ${serial}`, dataUrl: canvas.toDataURL('image/png') };
  } catch {
    return null;
  }
}

function ensureProofHost(): HTMLElement {
  let el = document.getElementById('oq-proof');
  if (!el) {
    el = document.createElement('div');
    el.id = 'oq-proof';
    el.setAttribute(
      'style',
      'position:absolute;left:-10000px;top:0;width:1100px;background:#fff;color:#111;padding:16px;font:14px/1.4 sans-serif;border:1px solid #ccc;',
    );
    document.body.appendChild(el);
  }
  return el;
}

export async function captureProof(caption: string, html: string): Promise<OqImage | null> {
  if (typeof document === 'undefined' || isJsdom()) return null;
  try {
    const host = ensureProofHost();
    host.innerHTML = html;
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(host, { backgroundColor: '#ffffff', scale: 2, logging: false });
    return { caption, dataUrl: canvas.toDataURL('image/png') };
  } catch {
    return null;
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function captureRecordProof(
  caption: string,
  bits: {
    serial?: string;
    status?: string;
    qty?: string;
    location?: string;
    audit?: string;
    request?: string;
    matrix?: string;
    attachment?: string;
    extra?: string;
  },
): Promise<OqImage | null> {
  const rows: string[] = [];
  const add = (k: string, v?: string) => {
    if (v) rows.push(`<tr><th style="text-align:left;padding:4px 8px;background:#f1f5f9">${escapeHtml(k)}</th><td style="padding:4px 8px">${escapeHtml(v)}</td></tr>`);
  };
  add('Serial', bits.serial);
  add('Status', bits.status);
  add('Qty', bits.qty);
  add('Location', bits.location);
  add('Audit', bits.audit);
  add('Request', bits.request);
  add('Matrix', bits.matrix);
  add('Attachment', bits.attachment);
  add('Note', bits.extra);
  const html = `<div><h3 style="margin:0 0 8px">OQ proof</h3><table style="border-collapse:collapse;width:100%;font-size:13px">${rows.join('')}</table></div>`;
  return captureProof(caption, html);
}

export function takeImages(...xs: Array<OqImage | null | undefined>): OqImage[] {
  return xs.filter((x): x is OqImage => Boolean(x?.dataUrl)).slice(0, 2);
}
