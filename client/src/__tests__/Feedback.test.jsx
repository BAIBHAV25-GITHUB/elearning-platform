import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { ConfirmProvider, useConfirm } from '../components/common/Confirm';
import { ToastProvider, useToast } from '../components/common/Toast';
import ProtectedRoute from '../components/ProtectedRoute';
import NotFound from '../pages/NotFound';

const mockUseAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

function Asker({ onResult }) {
  const confirm = useConfirm();
  return <button onClick={async () => onResult(await confirm({ message: 'Really delete?', confirmLabel: 'Delete' }))}>ask</button>;
}

describe('ConfirmProvider', () => {
  it('resolves true on confirm and false on cancel / Escape', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<ConfirmProvider><Asker onResult={onResult} /></ConfirmProvider>);

    await user.click(screen.getByText('ask'));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Really delete?');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onResult).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(screen.getByText('ask'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onResult).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByText('ask'));
    await user.keyboard('{Escape}');
    expect(onResult).toHaveBeenLastCalledWith(false);
  });
});

describe('ToastProvider', () => {
  it('shows an error toast that can be dismissed', async () => {
    const user = userEvent.setup();
    function T() { const toast = useToast(); return <button onClick={() => toast.error('Nope')}>go</button>; }
    render(<ToastProvider><T /></ToastProvider>);
    await user.click(screen.getByText('go'));
    expect(screen.getByRole('alert')).toHaveTextContent('Nope');
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('routing', () => {
  it('ProtectedRoute sends a guest to /login with ?next= for the page they wanted', () => {
    mockUseAuth.mockReturnValue({ user: null });
    render(
      <MemoryRouter initialEntries={['/my-learning?tab=1']}>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route element={<ProtectedRoute />}><Route path="/my-learning" element={<div>secret</div>} /></Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('next=%2Fmy-learning%3Ftab%3D1');
  });

  it('NotFound offers a way back', () => {
    render(<MemoryRouter><NotFound /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to courses/i })).toHaveAttribute('href', '/');
  });
});

function LoginProbe() {
  const loc = useLocation();
  return <div data-testid="probe">{loc.search}</div>;
}
