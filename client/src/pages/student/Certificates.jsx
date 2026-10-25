import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../api/axios';
import { qk } from '../../api/queryKeys';
import { apiError } from '../../utils/apiError';
import { formatDate } from '../../utils/format';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';

export default function Certificates() {
  const { data: certificates = [], isPending, error, refetch } = useQuery({
    queryKey: qk.certificates,
    queryFn: async () => (await api.get('/certificates/my-certificates')).data.certificates || [],
  });

  if (isPending) return <LoadingState label="Loading certificates..." />;
  if (error) return <ErrorState message={apiError(error, 'Failed to load your certificates.')} onRetry={refetch} />;

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold text-slate-800 mb-2">My Certificates</h1>
      <p className="text-slate-600 mb-8">View and download certificates awarded upon 100% course completion.</p>

      {certificates.length === 0 ? (
        <EmptyState title="No certificates earned yet." hint="Complete all lessons in a course to automatically generate your certificate." />
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
                  Issued on: {formatDate(cert.issued_at)}
                </p>
              </div>
              <div className="p-4 bg-slate-50 border-t border-slate-100">
                <Link
                  to={`/student/certificates/${cert.certificate_id}`}
                  className="block w-full text-center bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 rounded-lg text-sm transition"
                >
                  View / Download Certificate
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}