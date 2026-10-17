import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [searchParams] = useSearchParams();
  // /login?reason=disabled is where the axios interceptor sends a user whose account was deactivated
  const [error, setError] = useState(
    searchParams.get('reason') === 'disabled' ? 'Your account is not active. Please contact support.' : ''
  );
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const user = await login(email, password);
      // ?next=/courses/5 sends a guest back to the page they came from (same-site paths only)
      const next = searchParams.get('next');
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
      navigate(safeNext || (user.role === 'admin' ? '/admin' : user.role === 'instructor' ? '/instructor/courses' : '/'));
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    }
  };

  return (
    <div className="max-w-md mx-auto mt-16 p-6 bg-white rounded-xl shadow-md border">
      <h2 className="text-2xl font-bold mb-6 text-center">Login to EduStream</h2>
      {error && <div role="alert" className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="block text-sm font-medium mb-1">Email</label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            className="w-full border rounded px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="login-password" className="block text-sm font-medium mb-1">Password</label>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full border rounded px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="w-full bg-indigo-600 text-white py-2 rounded font-semibold">
          Login
        </button>
      </form>
      <p className="mt-4 text-center text-sm">
        Don't have an account? <Link className="text-indigo-600 font-semibold" to="/register">Register</Link>
      </p>
    </div>
  );
}