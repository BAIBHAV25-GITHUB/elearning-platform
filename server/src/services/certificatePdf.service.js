import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { env } from '../config/env.js';

/** Link on the certificate / QR code: the public verify page of the client app. */
export const verifyUrl = (code) => `${env.clientUrls[0].replace(/\/$/, '')}/verify/${code}`;

const formatDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Draws the certificate (A4 landscape) into `stream`. Built-in PDF fonts only, so very unusual (non-Latin)
 * characters in a name may not render; add a TTF with doc.registerFont if you need them.
 */
export const writeCertificatePdf = async (cert, stream) => {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Certificate - ${cert.course_title}` } });
  doc.pipe(stream);
  const W = doc.page.width;
  const H = doc.page.height;
  const indigo = '#4f46e5';

  doc.rect(24, 24, W - 48, H - 48).lineWidth(4).stroke(indigo);
  doc.rect(34, 34, W - 68, H - 68).lineWidth(1).stroke('#a5b4fc');

  const center = (text, y, opts = {}) =>
    doc.text(text, 60, y, { width: W - 120, align: 'center', ...opts });

  doc.fillColor(indigo).font('Helvetica-Bold').fontSize(12);
  center('EDUSTREAM', 70, { characterSpacing: 4 });
  doc.fillColor('#1e293b').font('Times-Bold').fontSize(38);
  center('Certificate of Completion', 100);
  doc.fillColor('#64748b').font('Helvetica').fontSize(14);
  center('This certifies that', 165);
  doc.fillColor('#0f172a').font('Times-Italic').fontSize(34);
  center(cert.student_name, 190, { lineBreak: false });
  doc.fillColor('#64748b').font('Helvetica').fontSize(14);
  center('has successfully completed the course', 245);
  doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(22);
  center(cert.course_title, 275, { height: 60 });

  doc.fillColor('#64748b').font('Helvetica').fontSize(12);
  center(`Issued on ${formatDate(cert.issued_at)}  |  Instructor: ${cert.instructor_name}`, 345);

  const url = verifyUrl(cert.verification_code);
  const qr = await QRCode.toBuffer(url, { margin: 1, width: 220 });
  doc.image(qr, 70, H - 160, { width: 80 });
  doc.fillColor('#475569').fontSize(9).text('Scan or visit to verify:', 160, H - 150, { width: 400 });
  doc.fillColor(indigo).fontSize(9).text(url, 160, H - 136, { width: 500 });
  doc.fillColor('#475569').text(`Certificate ID: ${cert.verification_code}`, 160, H - 118, { width: 400 });

  doc.end();
};
