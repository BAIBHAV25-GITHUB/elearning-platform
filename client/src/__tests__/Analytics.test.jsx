import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import Analytics from '../pages/instructor/Analytics';
import api from '../api/axios';
import { renderWithQuery as render } from '../test/utils';

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'instructor' } }) }));
vi.mock('../api/axios', () => ({ default: { get: vi.fn() } }));

const overview = {
  courseRevenue: [{ course_id: 1, course_title: 'Python', total_enrollments: 4, total_revenue: '2000' }],
  batchCapacity: [],
  studentProgress: [{ student_name: 'Asha', course_title: 'Python', completed_contents: 2, total_contents: 2, completion_percentage: 100 }],
};
const months = [
  { month: '2026-09', gross_revenue: '1800', refunded: '300', net_revenue: '1500', enrollments: 3 },
  { month: '2026-10', gross_revenue: '0', refunded: '0', net_revenue: '0', enrollments: 0 },
];
// answers each endpoint with its own payload (the page now calls /analytics/overview and /analytics/timeline)
const respond = ({ timeline = { success: true, data: { months } }, failTimeline } = {}) =>
  api.get.mockImplementation((url) => {
    if (url === '/analytics/timeline') return failTimeline ? Promise.reject(failTimeline) : Promise.resolve({ data: timeline });
    return Promise.resolve({ data: { success: true, data: overview } });
  });

describe('Analytics page', () => {
  it('shows headline numbers and keeps the data tables next to the charts', async () => {
    respond();
    render(<Analytics />);
    expect(await screen.findByText('Avg. completion')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Asha' })).toBeInTheDocument();
  });

  it('lists revenue per month with refunds subtracted', async () => {
    respond();
    render(<Analytics />);
    expect(await screen.findByRole('heading', { name: /revenue & enrollments over time/i })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /net and refunded revenue per month/i })).toBeInTheDocument();
    const row = (await screen.findByRole('rowheader', { name: 'Sep 26' })).closest('tr');
    expect(row).toHaveTextContent('₹1,800');
    expect(row).toHaveTextContent('₹300');
    expect(row).toHaveTextContent('₹1,500');
    expect(api.get).toHaveBeenCalledWith('/analytics/timeline', { params: { months: 12 } });
  });

  it('asks for another period when the range changes', async () => {
    respond();
    render(<Analytics />);
    await userEvent.selectOptions(await screen.findByLabelText('Show'), '24');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/analytics/timeline', { params: { months: 24 } }));
  });

  it('keeps the page when only the monthly figures fail, and can retry them', async () => {
    respond({ failTimeline: { response: { data: { message: 'timeline down' } } } });
    render(<Analytics />);
    expect(await screen.findByText('Avg. completion')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('timeline down');
    respond();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('rowheader', { name: 'Sep 26' })).toBeInTheDocument();
  });

  it('shows an error with retry when loading fails', async () => {
    api.get.mockRejectedValue({ response: { data: { message: 'boom' } } });
    render(<Analytics />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
