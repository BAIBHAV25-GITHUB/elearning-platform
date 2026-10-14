import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getInstructorCoursesApi, publishCourseApi } from '../../services/course.service';
import { formatPrice, formatDate } from '../../utils/format';

export default function CourseList() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const data = await getInstructorCoursesApi();
        setCourses(data.courses);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to fetch courses');
      } finally {
        setLoading(false);
      }
    };
    fetchCourses();
  }, []);

  const handlePublish = async (courseId) => {
    setError('');
    try {
      const data = await publishCourseApi(courseId);
      setCourses((prev) => prev.map((c) => (c.course_id === courseId ? { ...c, status: data.course.status } : c)));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to publish course');
    }
  };

  if (loading) return <div className="p-8 text-center">Loading your courses...</div>;

  return (
    <div className="max-w-6xl mx-auto mt-8 p-6">
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
                    <span className={`capitalize px-2 py-1 text-xs rounded ${course.status === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {course.status}
                    </span>
                  </td>
                  <td className="p-4">{formatPrice(course.price)}</td>
                  <td className="p-4 text-gray-500 text-sm">
                    {formatDate(course.created_at)}
                  </td>
                  <td className="p-4 space-x-3 text-sm">
                    <Link className="text-indigo-600 hover:underline" to={`/instructor/courses/${course.course_id}/modules`}>Manage</Link>
                    {course.status !== 'published' && (
                      <button onClick={() => handlePublish(course.course_id)} className="text-emerald-700 font-semibold hover:underline">
                        Publish
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