import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="text-6xl font-bold text-indigo-600">404</p>
      <h1 className="mt-4 text-2xl font-bold text-slate-800">Page not found</h1>
      <p className="mt-2 text-slate-600">The page you are looking for does not exist or has moved.</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-md bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        Back to courses
      </Link>
    </div>
  );
}
