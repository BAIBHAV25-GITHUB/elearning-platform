import { getCertificatesByStudentFromDb } from '../repositories/certificate.repository.js';
import { handleError } from '../utils/errors.js';

export const getMyCertificates = async (req, res) => {
  try {
    const certificates = await getCertificatesByStudentFromDb(req.user.id);
    return res.status(200).json({ success: true, certificates });
  } catch (error) {
    return handleError(res, error);
  }
};
