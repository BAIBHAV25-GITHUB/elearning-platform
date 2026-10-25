import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './common/NotificationBell';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuButton = useRef(null);

  // Escape closes the mobile menu (focus returns to the toggle button)
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const links = [{ to: '/', label: 'Courses', end: true }];
  if (user?.role === 'admin') links.push({ to: '/admin', label: 'Admin' });
  if (user?.role === 'instructor' || user?.role === 'admin') {
    links.push({ to: '/instructor/courses', label: 'My Courses' }, { to: '/instructor/analytics', label: 'Analytics' });
  }
  if (user?.role === 'student') {
    links.push({ to: '/my-learning', label: 'My Learning' }, { to: '/student/certificates', label: 'Certificates' });
  }

  const linkClass = ({ isActive }) =>
    `transition hover:text-indigo-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded ${
      isActive ? 'text-indigo-300 font-semibold' : ''
    }`;

  const buttons = user ? (
    <>
      <NotificationBell />
      <span className="text-sm bg-slate-800 px-3 py-1 rounded-full text-slate-300">
        {user.name} ({user.role})
      </span>
      <button
        onClick={handleLogout}
        className="bg-red-600 hover:bg-red-700 px-4 py-1.5 rounded-md text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
      >
        Logout
      </button>
    </>
  ) : (
    <>
      <NavLink to="/login" className={linkClass}>Login</NavLink>
      <Link
        to="/register"
        className="bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 rounded-md text-sm font-medium transition text-center"
      >
        Register
      </Link>
    </>
  );

  return (
    <nav className="bg-slate-900 text-white px-4 sm:px-6 py-4 shadow-md" aria-label="Main">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:text-slate-900 focus:px-3 focus:py-2 focus:rounded"
      >
        Skip to content
      </a>
      <div className="flex justify-between items-center">
        <Link to="/" className="text-xl font-bold tracking-wide text-indigo-400">
          EduStream
        </Link>

        {/* desktop */}
        <div className="hidden md:flex items-center space-x-6">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>{l.label}</NavLink>
          ))}
          {buttons}
        </div>

        {/* mobile toggle */}
        <button
          ref={menuButton}
          type="button"
          className="md:hidden p-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {open && (
        <div
          id="mobile-menu"
          className="md:hidden mt-4 flex flex-col gap-4 border-t border-slate-700 pt-4"
          onClick={(e) => e.target.closest('a, button') && setOpen(false)}
        >
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>{l.label}</NavLink>
          ))}
          <div className="flex flex-wrap items-center gap-3">{buttons}</div>
        </div>
      )}
    </nav>
  );
}
