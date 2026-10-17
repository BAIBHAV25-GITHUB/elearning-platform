import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi } from 'vitest';
import ProtectedRoute from '../components/ProtectedRoute';

const mockUseAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

function renderAt(user, allowedRoles) {
  mockUseAuth.mockReturnValue({ user });
  return render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route path="/" element={<div>home page</div>} />
        <Route path="/login" element={<div>login page</div>} />
        <Route element={<ProtectedRoute allowedRoles={allowedRoles} />}>
          <Route path="/secret" element={<div>secret page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  it('sends a guest to the login page', () => {
    renderAt(null, ['student']);
    expect(screen.getByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('secret page')).not.toBeInTheDocument();
  });

  it('redirects a user with the wrong role to the home page', () => {
    renderAt({ id: 1, role: 'student' }, ['admin']);
    expect(screen.getByText('home page')).toBeInTheDocument();
    expect(screen.queryByText('secret page')).not.toBeInTheDocument();
  });

  it('renders the page for an allowed role', () => {
    renderAt({ id: 1, role: 'admin' }, ['admin', 'instructor']);
    expect(screen.getByText('secret page')).toBeInTheDocument();
  });

  it('lets any logged-in user in when no roles are given', () => {
    renderAt({ id: 1, role: 'student' }, undefined);
    expect(screen.getByText('secret page')).toBeInTheDocument();
  });
});
