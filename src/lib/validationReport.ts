import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { APP_VERSION, DOC_ID, DOC_VERSION, VALIDATION_BANNER } from '../types';
import { toDisplayLocal, todayIsoDateInTz } from './dates';
import { downloadBlob } from './excelExport';
import { OQ_EVIDENCE_DISCLAIMER, type OqResult, type ValidationReport } from './selfValidation';

const MARGIN = 40;
const PAGE_W = 612;
const FOOTER_Y = 768;
const CONTENT_BOTTOM = 750;

function paintFooter(doc: jsPDF): void {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(60);
    doc.text(`${DOC_ID} v${DOC_VERSION} | ${VALIDATION_BANNER}`, MARGIN, FOOTER_Y, { maxWidth: PAGE_W - MARGIN * 2 });
    doc.text(
      `Page ${i} of ${n} | App ${APP_VERSION} | REPORT — not the system of record`,
      MARGIN,
      FOOTER_Y + 12,
    );
  }
}

function ensureSpace(doc: jsPDF, y: number, need: number): number {
  if (y + need <= CONTENT_BOTTOM) return y;
  doc.addPage();
  return 48;
}

function verdictColor(v: OqResult['verdict']): [number, number, number] {
  if (v === 'Pass') return [22, 101, 52];
  if (v === 'Fail') return [153, 27, 27];
  return [146, 64, 14];
}

export async function buildValidationPdf(report: ValidationReport): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  let y = 52;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Automated OQ evidence', MARGIN, y);
  y += 18;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('OQ/PQ-style sandbox protocol with screenshot evidence', MARGIN, y);
  y += 14;
  doc.setFontSize(9);
  doc.text('Every case includes screenshot evidence of that test.', MARGIN, y);
  y += 18;
  doc.setFontSize(11);

  const cover: [string, string][] = [
    ['Document', report.docId],
    ['OQ protocol', 'OQ-WH-INV-001'],
    ['App version', report.appVersion],
    ['Executed by', report.executedBy],
    ['Executed (UTC)', report.executedUtc],
    ['Executed (local)', toDisplayLocal(report.executedUtc)],
    ['Sandbox database', report.sandboxDb],
    ['Pass / Fail / Manual', `${report.passed} / ${report.failed} / ${report.manual}`],
  ];
  doc.setFontSize(10);
  for (const [k, v] of cover) {
    doc.setFont('helvetica', 'bold');
    doc.text(`${k}:`, MARGIN, y);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(v, PAGE_W - MARGIN * 2 - 120);
    doc.text(lines, MARGIN + 120, y);
    y += 14 * (Array.isArray(lines) ? lines.length : 1);
  }

  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Honest framing (cover)', MARGIN, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const framing =
    'Automated sandbox evidence with screenshots; not approved validation; live lots were not used. ' +
    OQ_EVIDENCE_DISCLAIMER +
    ' This pack is not a substitute for site-executed IQ/OQ/PQ and is not a vendor Part 11 certificate.';
  const frameLines = doc.splitTextToSize(framing, PAGE_W - MARGIN * 2);
  doc.text(frameLines, MARGIN, y);
  y += 14 * frameLines.length + 10;

  doc.setFont('helvetica', 'bold');
  doc.text('Summary', MARGIN, y);
  y += 8;
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Verdict', 'Count']],
    body: [
      ['Pass', String(report.passed)],
      ['Fail', String(report.failed)],
      ['Manual', String(report.manual)],
      ['Total', String(report.results.length)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [26, 54, 93], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    styles: { cellPadding: 3 },
  });
  y = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 80;
  y += 16;

  for (const r of report.results) {
    y = ensureSpace(doc, y, 90);
    const [vr, vg, vb] = verdictColor(r.verdict);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(vr, vg, vb);
    doc.text(`${r.id}  ${r.verdict}`, MARGIN, y);
    doc.setTextColor(0);
    y += 14;
    doc.setFontSize(10);
    doc.text(r.title, MARGIN, y);
    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`URS: ${r.urs}   ${r.ms} ms`, MARGIN, y);
    y += 12;
    const exp = doc.splitTextToSize(`Expected: ${r.expected}`, PAGE_W - MARGIN * 2);
    y = ensureSpace(doc, y, 14 * exp.length + 8);
    doc.text(exp, MARGIN, y);
    y += 12 * exp.length + 4;
    const act = doc.splitTextToSize(`Actual: ${r.actual}`, PAGE_W - MARGIN * 2);
    y = ensureSpace(doc, y, 14 * act.length + 8);
    doc.text(act, MARGIN, y);
    y += 12 * act.length + 8;

    const imgs = (r.images ?? []).slice(0, 8);
    for (const img of imgs) {
      if (!img?.dataUrl) continue;
      try {
        const fmt = img.dataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
        const props = doc.getImageProperties(img.dataUrl);
        const maxW = 520;
        const maxH = 240;
        let w = Math.min(maxW, props.width);
        let h = (props.height * w) / props.width;
        if (h > maxH) {
          w = (props.width * maxH) / props.height;
          h = maxH;
        }
        y = ensureSpace(doc, y, h + 24);
        doc.addImage(img.dataUrl, fmt, MARGIN, y, w, h);
        y += h + 10;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.text(img.caption || '', MARGIN, y, { maxWidth: PAGE_W - MARGIN * 2 });
        doc.setFont('helvetica', 'normal');
        y += 14;
      } catch {
        /* skip undecodable proof image */
      }
    }
    y += 8;
  }

  y = ensureSpace(doc, y, 90);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Signature block', MARGIN, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const sigLines = [
    `Printed name: ${report.printedName || ''}`,
    `User ID: ${report.signedUserId || ''}`,
    `Signed at (UTC): ${report.signedAtUtc || ''}`,
    `Meaning of signature: ${report.meaningOfSignature || ''}`,
  ];
  for (const line of sigLines) {
    const wrapped = doc.splitTextToSize(line, PAGE_W - MARGIN * 2);
    y = ensureSpace(doc, y, 12 * wrapped.length + 4);
    doc.text(wrapped, MARGIN, y);
    y += 12 * wrapped.length + 4;
  }

  paintFooter(doc);
  const buf = doc.output('arraybuffer');
  return new Blob([buf], { type: 'application/pdf' });
}

export async function downloadValidationReport(report: ValidationReport): Promise<void> {
  const blob = await buildValidationPdf(report);
  downloadBlob(blob, `WH-INV-OQ-PQ-evidence-${todayIsoDateInTz()}.pdf`);
}
