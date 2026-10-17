import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi } from 'vitest';
import CourseDetails from '../pages/CourseDetails';
import api from '../api/axios';

const mockUseAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const course = {
  course_id: 7,
  title: 'Intro to Testing',
  description: 'Learn it',
  price: '499.00',
  instructor_id: 20,
  modules: [],
};
const batches = [
  { batch_id: 1, batch_name: 'Batch A', start_date: '2026-11-01', end_date: '2026-12-01', current_capacity: 1, max_capacity: 10 },
];

function setup({ user, enrollments = [] }) {
  mockUseAuth.mockReturnValue({ user });
  api.get.mockImplementation((url) => {
    if (url === '/courses/7') return Promise.resolve({ data: { course } });
    if (url === '/courses/7/batches') return Promise.resolve({ data: { batches } });
    if (url === '/enrollments/me') return Promise.resolve({ data: { enrollments } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  render(
    <MemoryRouter initialEntries={['/courses/7']}>
      <Routes>
        <Route path="/courses/:courseId" element={<CourseDetails />} />
      </Routes>
    </MemoryRouter>
  );
  return screen.findByRole('heading', { name: 'Intro to Testing' });
}

beforeEach(() => vi.clearAllMocks());

describe('CourseDetails call to action', () => {
  it('guest: sees a login link that returns to the course, and no enroll button', async () => {
    await setup({ user: null });
    const link = screen.getByRole('link', { name: /log in to enroll/i });
    expect(link).toHaveAttribute('href', '/login?next=%2Fcourses%2F7');
    expect(screen.queryByRole('button', { name: /enroll/i })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/enrollments/me');
  });

  it('student without enrollment: can pick a batch and sees Enroll & Pay', async () => {
    await setup({ user: { id: 5, role: 'student', name: 'S' } });
    expect(await screen.findByText('Batch A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enroll & pay/i })).toBeEnabled();
    expect(screen.queryByRole('link', { name: /go to course/i })).not.toBeInTheDocument();
  });

  it('student with a pending enrollment still sees Enroll & Pay (not Go to course)', async () => {
    await setup({
      user: { id: 5, role: 'student' },
      enrollments: [{ course_id: 7, enrollment_status: 'pending' }],
    });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/enrollments/me'));
    expect(screen.getByRole('button', { name: /enroll & pay/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /go to course/i })).not.toBeInTheDocument();
  });

  it('enrolled student: sees Go to course', async () => {
    await setup({
      user: { id: 5, role: 'student' },
      enrollments: [{ course_id: 7, enrollment_status: 'active' }],
    });
    const link = await screen.findByRole('link', { name: /go to course/i });
    expect(link).toHaveAttribute('href', '/learn/7');
    expect(screen.queryByRole('button', { name: /enroll/i })).not.toBeInTheDocument();
  });

  it('instructor who owns the course: sees Manage course', async () => {
    await setup({ user: { id: 20, role: 'instructor' } });
    const link = screen.getByRole('link', { name: /manage course/i });
    expect(link).toHaveAttribute('href', '/instructor/courses/7/modules');
    expect(screen.queryByRole('button', { name: /enroll/i })).not.toBeInTheDocument();
  });

  it('admin: sees Manage course', async () => {
    await setup({ user: { id: 1, role: 'admin' } });
    expect(screen.getByRole('link', { name: /manage course/i })).toBeInTheDocument();
  });

  it('another instructor: gets the explanation and a disabled enroll button', async () => {
    await setup({ user: { id: 21, role: 'instructor' } });
    expect(screen.getByText(/only student accounts can enrol/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enroll & pay/i })).toBeDisabled();
  });
});
