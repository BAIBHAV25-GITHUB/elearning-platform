import { getCertificatesByStudentFromDb } from '../repositories/certificate.repository.js';

export const getMyCertificates = async (req, res) => {
  try {
    const studentId = req.user.user_id || req.user.id;
    const certificates = await getCertificatesByStudentFromDb(studentId);
    return res.status(200).json({ success: true, certificates });
  } catch (error) {
    console.error('Error fetching certificates:', error);
    return res.status(500).json({ message: error.message || 'Failed to fetch certificates.' });
  }
};