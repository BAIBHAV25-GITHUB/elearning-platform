import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shadow-md">
      <Link to="/" className="text-xl font-bold tracking-wide text-indigo-400">
        EduStream
      </Link>
      <div className="flex items-center space-x-6">
        <Link to="/" className="hover:text-indigo-300 transition">Courses</Link>
        {user ? (
          <>
            <span className="text-sm bg-slate-800 px-3 py-1 rounded-full text-slate-300">
              {user.name} ({user.role})
            </span>
            <button
              onClick={handleLogout}
              className="bg-red-600 hover:bg-red-700 px-4 py-1.5 rounded-md text-sm font-medium transition"
            >
              Logout
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="hover:text-indigo-300 transition">Login</Link>
            <Link
              to="/register"
              className="bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 rounded-md text-sm font-medium transition"
            >
              Register
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}