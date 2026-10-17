import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getInstructorCoursesApi, setCourseStatusApi, deleteCourseApi } from '../../services/course.service';
import { formatPrice, formatDate } from '../../utils/format';
import { qk } from '../../api/queryKeys';
import { apiError } from '../../utils/apiError';
import ApprovalBanner from '../../components/instructor/ApprovalBanner';
import { useConfirm } from '../../components/common/Confirm';
import StatusBadge from '../../components/common/StatusBadge';

export default function CourseList() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState('');

  const { data: courses = [], isPending, error: loadError } = useQuery({
    queryKey: qk.instructorCourses,
    queryFn: async () => (await getInstructorCoursesApi()).courses || [],
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.instructorCourses });

  const statusMutation = useMutation({
    mutationFn: ({ course, status }) => setCourseStatusApi(course.course_id, status),
    onSuccess: refresh,
    onError: (err) => setActionError(apiError(err, 'Failed to change the course status')),
  });
  const deleteMutation = useMutation({
    mutationFn: (course) => deleteCourseApi(course.course_id),
    onSuccess: refresh,
    onError: (err) => setActionError(apiError(err, 'Failed to delete the course')),
  });
  const busy = statusMutation.isPending || deleteMutation.isPending;
  const error = actionError || (loadError ? apiError(loadError, 'Failed to fetch courses') : '');

  // status: 'published' | 'draft' (unpublish) | 'archived' (archive / restore uses 'draft' or 'published')
  const changeStatus = async (course, status, confirmText) => {
    if (confirmText && !(await confirm({ title: 'Please confirm', message: confirmText }))) return;
    setActionError('');
    statusMutation.mutate({ course, status });
  };

  const removeCourse = async (course) => {
    if (!(await confirm({ title: 'Delete course', message: `Delete "${course.title}" permanently? All its modules, lessons and batches are removed. This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    setActionError('');
    deleteMutation.mutate(course);
  };

  if (isPending) return <div className="p-8 text-center">Loading your courses...</div>;

  return (
    <div className="max-w-6xl mx-auto mt-8 p-6">
      <ApprovalBanner />
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Instructor Dashboard: My Courses</h1>
        <Link
          to="/instructor/courses/new"
          className="bg-indigo-600 text-white px-4 py-2 rounded font-semibold hover:bg-indigo-700"
        >
          + Create Course
        </Link>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}

      {courses.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <p className="text-gray-500 mb-4">You have not created any courses yet.</p>
          <Link to="/instructor/courses/new" className="text-indigo-600 font-semibold underline">
            Create your first course
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg shadow border">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b text-gray-700 font-semibold text-sm">
                <th className="p-4">Title</th>
                <th className="p-4">Status</th>
                <th className="p-4">Price</th>
                <th className="p-4">Created Date</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.course_id} className="border-b hover:bg-gray-50">
                  <td className="p-4 font-medium text-indigo-600">
                    <Link to={`/instructor/courses/${course.course_id}/modules`}>{course.title}</Link>
                  </td>
                  <td className="p-4">
                    <StatusBadge status={course.status} />
                  </td>
                  <td className="p-4">{formatPrice(course.price)}</td>
                  <td className="p-4 text-gray-500 text-sm">
                    {formatDate(course.created_at)}
                  </td>
                  <td className="p-4 space-x-3 text-sm">
                    <Link className="text-indigo-600 hover:underline" to={`/instructor/courses/${course.course_id}/modules`}>Manage</Link>
                    {course.status !== 'archived' && (
                      <Link className="text-indigo-600 hover:underline" to={`/instructor/courses/${course.course_id}/edit`}>Edit</Link>
                    )}
                    {course.status === 'draft' && (
                      <button disabled={busy} onClick={() => changeStatus(course, 'published')} className="text-emerald-700 font-semibold hover:underline">
                        Publish
                      </button>
                    )}
                    {course.status === 'published' && (
                      <button
                        disabled={busy}
                        onClick={() => changeStatus(course, 'draft', 'Unpublish this course? It will disappear from the catalog.')}
                        className="text-yellow-700 hover:underline"
                      >
                        Unpublish
                      </button>
                    )}
                    {course.status !== 'archived' && (
                      <button
                        disabled={busy}
                        onClick={() => changeStatus(course, 'archived', 'Archive this course? New students cannot enroll, enrolled students keep access.')}
                        className="text-gray-600 hover:underline"
                      >
                        Archive
                      </button>
                    )}
                    {course.status !== 'published' && course.enrollment_count === 0 && (
                      <button disabled={busy} onClick={() => removeCourse(course)} className="text-red-600 hover:underline disabled:opacity-50">
                        Delete
                      </button>
                    )}
                    {course.status === 'archived' && (
                      <button disabled={busy} onClick={() => changeStatus(course, 'draft')} className="text-emerald-700 font-semibold hover:underline">
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}