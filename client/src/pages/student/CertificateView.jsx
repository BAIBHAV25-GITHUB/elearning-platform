import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/axios';
import { formatDate } from '../../utils/format';

// Rendered in-app and printable ("Save as PDF" from the print dialog) instead of the old made-up external URL (F19)
export default function CertificateView() {
  const { certificateId } = useParams();
  const [cert, setCert] = useState(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    api
      .get('/certificates/my-certificates')
      .then((res) => {
        const found = (res.data.certificates || []).find((c) => String(c.certificate_id) === certificateId);
        setCert(found || null);
        setState(found ? 'ok' : 'missing');
      })
      .catch(() => setState('missing'));
  }, [certificateId]);

  if (state === 'loading') return <div className="text-center py-20 text-slate-600">Loading certificate...</div>;
  if (!cert) return <div className="text-center py-20 text-slate-600">Certificate not found.</div>;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="print:hidden flex justify-between mb-6">
        <Link to="/student/certificates" className="text-indigo-600 text-sm font-medium">&larr; All certificates</Link>
        <button onClick={() => window.print()} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">
          Print / Save as PDF
        </button>
      </div>
      <div className="bg-white border-8 border-double border-indigo-200 p-12 text-center space-y-5">
        <p className="uppercase tracking-widest text-xs text-indigo-600 font-semibold">EduStream</p>
        <h1 className="text-4xl font-serif font-bold text-slate-800">Certificate of Completion</h1>
        <p className="text-slate-500">This certifies that</p>
        <p className="text-3xl font-serif text-slate-900">{cert.student_name}</p>
        <p className="text-slate-500">has successfully completed the course</p>
        <p className="text-2xl font-semibold text-slate-800">{cert.course_title}</p>
        <p className="text-sm text-slate-500 pt-4">Issued on {formatDate(cert.issued_at)}</p>
        <p className="text-xs text-slate-400">Certificate ID: {cert.certificate_id}</p>
      </div>
    </div>
  );
}
