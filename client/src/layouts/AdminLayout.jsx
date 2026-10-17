import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/courses', label: 'Courses' },
  { to: '/admin/payments', label: 'Payments' },
  { to: '/admin/audit-log', label: 'Audit log' },
];

export default function AdminLayout() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">Admin</h1>
        <nav className="mt-4 flex flex-wrap gap-2 border-b border-slate-200">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `px-4 py-2 text-sm font-medium -mb-px border-b-2 transition ${
                  isActive
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
