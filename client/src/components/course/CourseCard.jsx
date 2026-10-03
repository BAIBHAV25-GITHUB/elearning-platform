import { Link } from 'react-router-dom';

export default function CourseCard({ course }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col justify-between">
      <div>
        <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
          By {course.instructor_name || 'Instructor'}
        </span>
        <h3 className="text-lg font-bold text-gray-900 mt-2 mb-1">{course.title}</h3>
        <p className="text-sm text-gray-600 line-clamp-2 mb-4">
          {course.description || 'No summary available.'}
        </p>
      </div>
      <div className="flex justify-between items-center pt-3 border-t">
        <span className="text-xl font-bold text-gray-900">
          ${Number(course.price).toFixed(2)}
        </span>
        <Link
          to={`/courses/${course.course_id}`}
          className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-indigo-700"
        >
          View Course
        </Link>
      </div>
    </div>
  );
}