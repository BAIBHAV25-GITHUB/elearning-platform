import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/axios';
import { formatDate } from '../../utils/format';

// On-screen copy of the certificate. "Download PDF" fetches the server-generated PDF (with a QR code that
// opens the public verify page); print still works too.
export default function CertificateView() {
  const { certificateId } = useParams();
  const [cert, setCert] = useState(null);
  const [state, setState] = useState('loading');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/certificates/${certificateId}`)
      .then((res) => {
        setCert(res.data.certificate);
        setState('ok');
      })
      .catch(() => setState('missing'));
  }, [certificateId]);

  const downloadPdf = async () => {
    setDownloading(true);
    setError('');
    try {
      const res = await api.get(`/certificates/${certificateId}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `certificate-${cert.verification_code}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not download the PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  if (state === 'loading') return <div className="text-center py-20 text-slate-600">Loading certificate...</div>;
  if (!cert) return <div className="text-center py-20 text-slate-600">Certificate not found.</div>;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="print:hidden flex justify-between items-center mb-6 gap-3">
        <Link to="/student/certificates" className="text-indigo-600 text-sm font-medium">&larr; All certificates</Link>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="border border-slate-300 px-4 py-2 rounded-lg text-sm font-semibold">
            Print
          </button>
          <button
            onClick={downloadPdf}
            disabled={downloading}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {downloading ? 'Preparing...' : 'Download PDF'}
          </button>
        </div>
      </div>
      {error && <div className="print:hidden bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
      <div className="bg-white border-8 border-double border-indigo-200 p-12 text-center space-y-5">
        <p className="uppercase tracking-widest text-xs text-indigo-600 font-semibold">EduStream</p>
        <h1 className="text-4xl font-serif font-bold text-slate-800">Certificate of Completion</h1>
        <p className="text-slate-500">This certifies that</p>
        <p className="text-3xl font-serif text-slate-900">{cert.student_name}</p>
        <p className="text-slate-500">has successfully completed the course</p>
        <p className="text-2xl font-semibold text-slate-800">{cert.course_title}</p>
        <p className="text-sm text-slate-500 pt-4">
          Issued on {formatDate(cert.issued_at)} · Instructor: {cert.instructor_name}
        </p>
        <p className="text-xs text-slate-400">
          Certificate ID: {cert.verification_code}
          <br />
          Verify at {cert.verify_url}
        </p>
      </div>
    </div>
  );
}
