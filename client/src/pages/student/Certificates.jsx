import { useEffect, useState } from 'react';
import api from '../../api/axios';

export default function Certificates() {
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCertificates = async () => {
      try {
        const res = await api.get('/certificates/my-certificates');
        setCertificates(res.data.certificates || []);
      } catch (err) {
        console.error('Failed to load certificates:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCertificates();
  }, []);

  if (loading) return <div className="text-center py-20 text-slate-600">Loading certificates...</div>;

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold text-slate-800 mb-2">My Certificates</h1>
      <p className="text-slate-600 mb-8">View and download certificates awarded upon 100% course completion.</p>

      {certificates.length === 0 ? (
        <div className="p-12 text-center bg-white border border-slate-200 rounded-xl shadow-sm">
          <p className="text-slate-500 font-medium">No certificates earned yet.</p>
          <p className="text-xs text-slate-400 mt-1">Complete all lessons in a course to automatically generate your certificate.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {certificates.map((cert) => (
            <div key={cert.certificate_id} className="bg-white rounded-xl shadow-md border border-slate-100 overflow-hidden flex flex-col justify-between">
              <div className="p-6">
                <div className="flex items-center gap-2 text-indigo-600 font-semibold text-xs uppercase tracking-wide mb-2">
                  🎓 Certificate of Completion
                </div>
                <h3 className="text-lg font-bold text-slate-800 line-clamp-2">{cert.course_title}</h3>
                <p className="text-xs text-slate-500 mt-2">
                  Issued to <span className="font-medium text-slate-700">{cert.student_name}</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Issued on: {new Date(cert.issued_at).toLocaleDateString()}
                </p>
              </div>
              <div className="p-4 bg-slate-50 border-t border-slate-100">
                <a
                  href={cert.certificate_url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 rounded-lg text-sm transition"
                >
                  View / Download Certificate
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}