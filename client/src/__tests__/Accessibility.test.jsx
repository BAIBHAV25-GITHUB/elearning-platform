import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';
import Modal from '../components/common/Modal';
import NotificationBell from '../components/common/NotificationBell';
import StatusBadge from '../components/common/StatusBadge';
import api from '../api/axios';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), put: vi.fn() } }));

function Host({ busy = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      {open && (
        <Modal title="Refund payment" onClose={() => setOpen(false)} busy={busy}>
          <label htmlFor="reason">Reason</label>
          <textarea id="reason" />
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button">Refund</button>
        </Modal>
      )}
    </>
  );
}

describe('Modal', () => {
  it('is a labelled dialog, moves focus in, keeps Tab inside and returns focus on Escape', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);

    expect(screen.getByRole('dialog', { name: 'Refund payment' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Reason')).toHaveFocus();

    await user.tab(); // Cancel
    await user.tab(); // Refund
    await user.tab(); // wraps to the first field
    expect(screen.getByLabelText('Reason')).toHaveFocus();
    await user.tab({ shift: true }); // and back to the last button
    expect(screen.getByRole('button', { name: 'Refund' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('ignores Escape while a request is running', async () => {
    const user = userEvent.setup();
    render(<Host busy />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('NotificationBell', () => {
  beforeEach(() => {
    api.get.mockResolvedValue({
      data: {
        notifications: [{ notification_id: 1, message: 'Welcome', is_read: false, created_at: '2026-10-01T10:00:00Z' }],
      },
    });
  });

  it('has an accessible name with the unread count, reports expanded state and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    expect(bell).toHaveAttribute('aria-expanded', 'false');

    await user.click(bell);
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveTextContent('Welcome');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });

  it('closes when you click elsewhere', async () => {
    const user = userEvent.setup();
    render(
      <>
        <NotificationBell />
        <p>elsewhere</p>
      </>
    );
    await user.click(await screen.findByRole('button', { name: /notifications/i }));
    await user.click(screen.getByText('elsewhere'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument());
  });
});

describe('StatusBadge', () => {
  it('always shows the status as text, with an icon that screen readers skip', () => {
    const { container } = render(
      <>
        <StatusBadge status="refunded" />
        <StatusBadge status="needs refund" />
        <StatusBadge status="mystery" />
      </>
    );
    expect(screen.getByText('refunded')).toBeInTheDocument();
    expect(screen.getByText('needs refund')).toBeInTheDocument();
    expect(screen.getByText('mystery')).toBeInTheDocument(); // unknown statuses still render, just without an icon
    const icons = container.querySelectorAll('svg');
    expect(icons).toHaveLength(2);
    icons.forEach((i) => expect(i).toHaveAttribute('aria-hidden', 'true'));
  });
});
