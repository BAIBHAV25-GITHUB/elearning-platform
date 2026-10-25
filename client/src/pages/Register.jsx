import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('student');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    try {
      const user = await register(name, email, password, role);
      navigate(user.role === 'instructor' ? '/instructor/courses' : '/');
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed');
    }
  };

  return (
    <div className="max-w-md mx-auto mt-16 p-6 bg-white rounded-xl shadow-md border">
      <h2 className="text-2xl font-bold mb-6 text-center">Create Account</h2>
      {error && <div role="alert" className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="reg-name" className="block text-sm font-medium mb-1">Full Name</label>
          <input
            id="reg-name"
            type="text"
            required
            className="w-full border rounded px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="reg-email" className="block text-sm font-medium mb-1">Email</label>
          <input
            id="reg-email"
            type="email"
            required
            className="w-full border rounded px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="reg-password" className="block text-sm font-medium mb-1">Password</label>
          <input
            id="reg-password"
            type="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            aria-describedby="reg-password-hint"
            className="w-full border rounded px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p id="reg-password-hint" className="text-xs text-slate-500 mt-1">At least 8 characters.</p>
        </div>
        <div>
          <label htmlFor="reg-confirm" className="block text-sm font-medium mb-1">Confirm password</label>
          <input
            id="reg-confirm"
            type="password"
            required
            autoComplete="new-password"
            className="w-full border rounded px-3 py-2"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="reg-role" className="block text-sm font-medium mb-1">Role</label>
          <select
            id="reg-role"
            className="w-full border rounded px-3 py-2 bg-white"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="student">Student</option>
            <option value="instructor">Instructor</option>
          </select>
          {role === 'instructor' && (
            <p className="text-xs text-slate-500 mt-1">
              Instructor accounts are reviewed by an admin before you can create or publish courses.
              An account has one role, so use a separate student account if you also want to take courses.
            </p>
          )}
        </div>
        <button type="submit" className="w-full bg-indigo-600 text-white py-2 rounded font-semibold">
          Register
        </button>
      </form>
      <p className="mt-4 text-center text-sm">
        Already have an account? <Link className="text-indigo-600 font-semibold" to="/login">Login</Link>
      </p>
    </div>
  );
}