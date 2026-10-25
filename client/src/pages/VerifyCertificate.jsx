import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';
import { formatDate } from '../utils/format';

// Public page (no login): anyone with the code / QR on a certificate can check that it is real.
export default function VerifyCertificate() {
  const { code } = useParams();
  const [state, setState] = useState('loading'); // loading | valid | invalid | error
  const [cert, setCert] = useState(null);

  useEffect(() => {
    api
      .get(`/certificates/verify/${encodeURIComponent(code)}`)
      .then((res) => {
        setCert(res.data.certificate);
        setState('valid');
      })
      .catch((err) => setState(err.response?.status === 404 ? 'invalid' : 'error'));
  }, [code]);

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Certificate verification</h1>
      {state === 'loading' && <p className="text-slate-600">Checking...</p>}
      {state === 'invalid' && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-5 rounded-xl">
          No certificate matches the code <span className="font-mono">{code}</span>. Check that it was typed correctly.
        </div>
      )}
      {state === 'error' && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-5 rounded-xl">
          The check could not be completed right now. Please try again in a few minutes.
        </div>
      )}
      {state === 'valid' && cert && (
        <div className="bg-white border border-emerald-200 rounded-xl p-6 space-y-3">
          <div className="text-emerald-700 font-semibold">✓ This certificate is genuine</div>
          <dl className="text-sm text-slate-700 space-y-2">
            <div><dt className="text-xs uppercase text-slate-400">Awarded to</dt><dd className="font-medium">{cert.student_name}</dd></div>
            <div><dt className="text-xs uppercase text-slate-400">Course</dt><dd className="font-medium">{cert.course_title}</dd></div>
            <div><dt className="text-xs uppercase text-slate-400">Instructor</dt><dd>{cert.instructor_name}</dd></div>
            <div><dt className="text-xs uppercase text-slate-400">Issued on</dt><dd>{formatDate(cert.issued_at)}</dd></div>
            <div><dt className="text-xs uppercase text-slate-400">Certificate ID</dt><dd className="font-mono">{cert.verification_code}</dd></div>
          </dl>
        </div>
      )}
      <p className="mt-6 text-sm"><Link to="/" className="text-indigo-600">&larr; EduStream</Link></p>
    </div>
  );
}
