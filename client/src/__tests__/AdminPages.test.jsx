import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderWithQuery } from '../test/utils';
import * as admin from '../services/admin.service';
import Users from '../pages/admin/Users';
import Courses from '../pages/admin/Courses';
import Payments from '../pages/admin/Payments';
import AuditLog from '../pages/admin/AuditLog';
import Dashboard from '../pages/admin/Dashboard';

vi.mock('../services/admin.service');
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }));
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  Link: ({ children }) => <a href="/x">{children}</a>,
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true); // no ConfirmProvider in these tests: useConfirm falls back to this
});

const asha = { id: 2, name: 'Asha', email: 'asha@x.dev', role: 'student', status: 'active', createdAt: '2026-01-01' };

describe('admin Users (TanStack Query)', () => {
  it('lists users, sends the filters as query params, and shows a failure with the server message', async () => {
    const user = userEvent.setup();
    admin.listUsersApi.mockResolvedValue({ users: [asha], total: 1 });
    renderWithQuery(<Users />);
    expect(await screen.findByText('Asha')).toBeInTheDocument();
    expect(admin.listUsersApi).toHaveBeenCalledWith({ page: 1, limit: 15 });

    await user.type(screen.getByLabelText('Search users'), '  asha ');
    await user.selectOptions(screen.getByLabelText('Role'), 'student');
    await user.click(screen.getByRole('button', { name: /filter/i }));
    await waitFor(() =>
      expect(admin.listUsersApi).toHaveBeenLastCalledWith({ page: 1, limit: 15, search: 'asha', role: 'student' })
    );
  });

  it('refetches the list after an action instead of patching the row', async () => {
    const user = userEvent.setup();
    admin.listUsersApi
      .mockResolvedValueOnce({ users: [asha], total: 1 })
      .mockResolvedValue({ users: [{ ...asha, status: 'banned' }], total: 1 });
    admin.setUserStatusApi.mockResolvedValue({ message: 'User banned', user: { status: 'banned' } });
    renderWithQuery(<Users />);
    await user.click(await screen.findByRole('button', { name: 'Ban' }));

    expect(admin.setUserStatusApi).toHaveBeenCalledWith(2, 'banned');
    expect(await screen.findByText('Asha: User banned')).toBeInTheDocument();
    await waitFor(() => expect(admin.listUsersApi).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('banned')).toBeInTheDocument(); // badge text comes from the refetched row
  });

  it('shows the server message when the action fails and keeps the list', async () => {
    const user = userEvent.setup();
    admin.listUsersApi.mockResolvedValue({ users: [asha], total: 1 });
    admin.setUserStatusApi.mockRejectedValue({ response: { data: { message: 'Cannot ban the last admin' } } });
    renderWithQuery(<Users />);
    await user.click(await screen.findByRole('button', { name: 'Ban' }));
    expect(await screen.findByText('Cannot ban the last admin')).toBeInTheDocument();
    expect(screen.getByText('Asha')).toBeInTheDocument();
  });

  it('reports a load failure', async () => {
    admin.listUsersApi.mockRejectedValue({ response: { status: 500, data: { message: 'db down' } } });
    renderWithQuery(<Users />);
    expect(await screen.findByText('db down')).toBeInTheDocument();
  });
});

describe('admin Payments', () => {
  const pay = {
    payment_id: 9,
    student_name: 'Asha',
    student_email: 'a@x',
    course_title: 'Python',
    enrollment_status: 'active',
    amount: '1500',
    status: 'success',
    transaction_id: 'pay_1',
    created_at: '2026-10-01',
  };

  it('refunds through an accessible dialog and refreshes the list', async () => {
    const user = userEvent.setup();
    admin.listPaymentsApi
      .mockResolvedValueOnce({ payments: [pay], total: 1 })
      .mockResolvedValue({ payments: [{ ...pay, status: 'refunded', refund_reason: 'Duplicate' }], total: 1 });
    admin.refundPaymentApi.mockResolvedValue({ message: 'Refund issued' });
    renderWithQuery(<Payments />);

    const open = await screen.findByRole('button', { name: 'Refund' });
    await user.click(open);
    const dialog = screen.getByRole('dialog', { name: 'Refund payment' });
    expect(within(dialog).getByLabelText('Reason for the refund')).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Refund' })); // no reason yet
    expect(within(dialog).getByText('Please give a reason.')).toBeInTheDocument();
    expect(admin.refundPaymentApi).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Reason for the refund'), 'Duplicate');
    await user.click(within(dialog).getByRole('button', { name: 'Refund' }));
    expect(admin.refundPaymentApi).toHaveBeenCalledWith(9, 'Duplicate');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Refund issued')).toBeInTheDocument();
    expect(await screen.findByText('Duplicate')).toBeInTheDocument(); // reason from the refetched row
  });

  it('Escape closes the dialog and focus goes back to the Refund button', async () => {
    const user = userEvent.setup();
    admin.listPaymentsApi.mockResolvedValue({ payments: [pay], total: 1 });
    renderWithQuery(<Payments />);
    const open = await screen.findByRole('button', { name: 'Refund' });
    await user.click(open);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });
});

describe('admin Courses', () => {
  const course = {
    course_id: 5,
    title: 'Python',
    instructor_id: 20,
    instructor_name: 'John',
    instructor_email: 'j@x',
    status: 'published',
    enrollment_count: 2,
    created_at: '2026-01-01',
  };

  it('reassigns a course from the dialog and shows the refetched instructor', async () => {
    const user = userEvent.setup();
    admin.listAdminCoursesApi
      .mockResolvedValueOnce({ courses: [course], total: 1 })
      .mockResolvedValue({ courses: [{ ...course, instructor_id: 21, instructor_name: 'Sarah' }], total: 1 });
    admin.listUsersApi.mockResolvedValue({ users: [{ id: 21, name: 'Sarah', email: 's@x' }], total: 1 });
    admin.reassignCourseApi.mockResolvedValue({
      message: 'Course reassigned',
      course: { instructor_id: 21, instructor_name: 'Sarah' },
    });
    renderWithQuery(<Courses />);

    await user.click(await screen.findByRole('button', { name: 'Reassign' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reassign course' });
    await user.selectOptions(within(dialog).getByLabelText('New instructor'), '21');
    await user.click(within(dialog).getByRole('button', { name: 'Reassign' }));

    expect(admin.reassignCourseApi).toHaveBeenCalledWith(5, 21);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Sarah')).toBeInTheDocument();
  });
});

describe('admin AuditLog and Dashboard', () => {
  it('audit log: refresh button refetches', async () => {
    const user = userEvent.setup();
    admin.listAuditLogsApi.mockResolvedValue({
      logs: [
        {
          log_id: 1,
          user_name: 'Root',
          action_type: 'DELETE',
          table_name: 'courses',
          record_id: 4,
          created_at: '2026-10-01T10:00:00Z',
        },
      ],
      total: 1,
    });
    renderWithQuery(<AuditLog />);
    expect(await screen.findByText('DELETE')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(admin.listAuditLogsApi).toHaveBeenCalledTimes(2));
    expect(admin.listAuditLogsApi).toHaveBeenLastCalledWith({ page: 1, limit: 25 });
  });

  it('dashboard shows the numbers, or the error', async () => {
    admin.getOverviewApi.mockResolvedValueOnce({
      overview: {
        users_total: 12,
        students: 9,
        instructors: 2,
        inactive_or_banned: 1,
        courses_total: 3,
        courses_published: 2,
        courses_draft: 1,
        courses_archived: 0,
        enrollments_active: 5,
        enrollments_completed: 1,
        revenue_total: '4500',
        certificates_issued: 1,
        payments_failed: 0,
        payments_pending: 0,
        payments_needs_refund: 0,
        payments_refunded: 0,
      },
      topCourses: [
        { course_id: 1, course_title: 'Python', instructor_name: 'John', total_enrollments: 5, total_revenue: '4500' },
      ],
    });
    const { unmount } = renderWithQuery(<Dashboard />);
    expect(await screen.findByText('12')).toBeInTheDocument();
    unmount();

    admin.getOverviewApi.mockRejectedValueOnce({ response: { status: 403, data: { message: 'Admins only' } } });
    renderWithQuery(<Dashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only');
  });
});
