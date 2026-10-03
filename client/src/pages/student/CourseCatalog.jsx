import { useEffect, useState } from 'react';
import api from '../../api/axios';
import CourseCard from '../../components/course/CourseCard';

export default function CourseCatalog() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        const res = await api.get('/v1/courses');
        setCourses(res.data.courses || []);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load courses');
      } finally {
        setLoading(false);
      }
    };
    fetchCatalog();
  }, []);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading catalog...</div>;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-gray-900">Explore Courses</h1>
        <p className="text-gray-600 mt-1">Discover structured learning modules built by expert instructors.</p>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4">{error}</div>}

      {courses.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-lg bg-gray-50 text-gray-500">
          No published courses available right now. Check back soon!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {courses.map((course) => (
            <CourseCard key={course.course_id} course={course} />
          ))}
        </div>
      )}
    </div>
  );
}