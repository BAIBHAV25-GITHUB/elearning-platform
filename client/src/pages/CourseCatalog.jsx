import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';

export default function CourseCatalog() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/courses')
      .then((res) => setCourses(res.data.courses))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-20">Loading courses...</div>;

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold mb-8 text-slate-800">Explore Courses</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {courses.map((course) => (
          <div key={course.id} className="bg-white rounded-xl shadow-md overflow-hidden border border-slate-100 flex flex-col">
            <img
              src={course.thumbnail_url || 'https://via.placeholder.com/400x225?text=Course+Thumbnail'}
              alt={course.title}
              className="h-48 w-full object-cover"
            />
            <div className="p-5 flex flex-col flex-grow">
              <h2 className="text-xl font-bold text-slate-800 mb-2">{course.title}</h2>
              <p className="text-slate-600 text-sm mb-4 line-clamp-2">{course.description}</p>
              <div className="mt-auto flex justify-between items-center pt-4 border-t border-slate-100">
                <span className="text-lg font-bold text-indigo-600">₹{course.price}</span>
                <Link
                  to={`/courses/${course.id}`}
                  className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-4 py-2 rounded-lg font-semibold text-sm transition"
                >
                  View Course
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}