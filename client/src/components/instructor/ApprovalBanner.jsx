import { useAuth } from '../../context/AuthContext';

/** Shown to instructors whose account has not been approved by an admin yet (IMPROVEMENTS.md 3.2). */
export default function ApprovalBanner() {
  const { user } = useAuth();
  if (user?.role !== 'instructor' || user.instructorStatus === 'approved') return null;
  const rejected = user.instructorStatus === 'rejected';
  return (
    <div
      className={`p-3 rounded mb-4 text-sm border ${
        rejected ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-800 border-amber-200'
      }`}
    >
      {rejected
        ? 'Your instructor application was rejected, so you cannot create or publish courses. Please contact support.'
        : 'Your instructor account is waiting for admin approval. You can create and publish courses once it is approved (sign in again after approval).'}
    </div>
  );
}
