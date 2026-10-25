import {
  getCertificatesByStudentFromDb,
  getCertificateByIdFromDb,
  getCertificateByCodeFromDb,
} from '../repositories/certificate.repository.js';
import { writeCertificatePdf, verifyUrl } from '../services/certificatePdf.service.js';
import { handleError, toId } from '../utils/errors.js';

const toPublic = (c) => ({ ...c, verify_url: verifyUrl(c.verification_code) });

export const getMyCertificates = async (req, res) => {
  try {
    const certificates = await getCertificatesByStudentFromDb(req.user.id);
    return res.status(200).json({ success: true, certificates: certificates.map(toPublic) });
  } catch (error) {
    return handleError(res, error);
  }
};

/** Owner or admin; 404 for everyone else so ids can't be probed. */
const loadOwned = async (req) => {
  const id = toId(req.params.certificateId);
  const cert = id ? await getCertificateByIdFromDb(id) : null;
  if (!cert || (cert.student_id !== req.user.id && req.user.role !== 'admin')) return null;
  return cert;
};

/** GET /certificates/:certificateId */
export const getCertificate = async (req, res) => {
  try {
    const cert = await loadOwned(req);
    if (!cert) return res.status(404).json({ success: false, message: 'Certificate not found' });
    return res.status(200).json({ success: true, certificate: toPublic(cert) });
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /certificates/:certificateId/pdf */
export const downloadCertificatePdf = async (req, res) => {
  try {
    const cert = await loadOwned(req);
    if (!cert) return res.status(404).json({ success: false, message: 'Certificate not found' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${cert.verification_code}.pdf"`);
    await writeCertificatePdf(cert, res);
    return undefined;
  } catch (error) {
    if (res.headersSent) return res.end();
    return handleError(res, error);
  }
};

/** GET /certificates/verify/:code  (public). Only what is printed on the certificate is returned. */
export const verifyCertificate = async (req, res) => {
  try {
    const code = String(req.params.code || '');
    if (!/^[A-Za-z0-9]{6,16}$/.test(code)) return res.status(404).json({ valid: false, message: 'Certificate not found' });
    const cert = await getCertificateByCodeFromDb(code);
    if (!cert) return res.status(404).json({ valid: false, message: 'Certificate not found' });
    return res.status(200).json({
      valid: true,
      certificate: {
        verification_code: cert.verification_code,
        student_name: cert.student_name,
        course_title: cert.course_title,
        instructor_name: cert.instructor_name,
        issued_at: cert.issued_at,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};
