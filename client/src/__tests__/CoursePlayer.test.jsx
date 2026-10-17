import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import CoursePlayer from '../pages/student/CoursePlayer';
import api from '../api/axios';

const mockUseAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
// the real players need media APIs jsdom does not have; the test only checks which one is chosen
vi.mock('../components/video/VideoPlayer', () => ({ default: ({ videoUrl }) => <div>video-player {videoUrl}</div> }));
vi.mock('../components/video/LessonPlayer', () => ({ default: () => <div>lesson-player</div> }));
vi.mock('../components/lesson/ReadingLesson', () => ({ default: ({ content }) => <div>reading-lesson {content.title}</div> }));
vi.mock('../components/discussion/ModuleComments', () => ({ default: () => <div>comments</div> }));

const course = {
  course_id: 7,
  title: 'Intro to Testing',
  instructor_id: 20,
  modules: [
    {
      module_id: 1,
      title: 'Basics',
      contents: [
        { content_id: 100, title: 'Welcome', type: 'video', status: 'ready', video_url: 'https://cdn/x.mp4', duration_sec: 60 },
        { content_id: 101, title: 'Cheat sheet', type: 'pdf', status: 'ready' },
      ],
    },
  ],
};

function Where() {
  const loc = useLocation();
  return <div>course page notice: {loc.state?.notice || 'none'}</div>;
}

function setup({ user, enrollments = [], progress = [] }) {
  mockUseAuth.mockReturnValue({ user });
  api.get.mockImplementation((url) => {
    if (url === '/courses/7') return Promise.resolve({ data: { course } });
    if (url === '/enrollments/me') return Promise.resolve({ data: { enrollments } });
    if (url.startsWith('/progress/')) return Promise.resolve({ data: { progress } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  render(
    <MemoryRouter initialEntries={['/learn/7']}>
      <Routes>
        <Route path="/learn/:courseId" element={<CoursePlayer />} />
        <Route path="/courses/:courseId" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('CoursePlayer access states', () => {
  it('no enrollment: redirects to the course page with an enroll notice', async () => {
    setup({ user: { id: 5, role: 'student' } });
    expect(await screen.findByText(/course page notice: Enroll in this course/i)).toBeInTheDocument();
    expect(screen.queryByText(/video-player/)).not.toBeInTheDocument();
  });

  it('pending enrollment: redirects with a payment notice', async () => {
    setup({ user: { id: 5, role: 'student' }, enrollments: [{ course_id: 7, enrollment_id: 1, enrollment_status: 'pending' }] });
    expect(await screen.findByText(/waiting for payment/i)).toBeInTheDocument();
  });

  it('dropped enrollment: redirects like no enrollment', async () => {
    setup({ user: { id: 5, role: 'student' }, enrollments: [{ course_id: 7, enrollment_id: 1, enrollment_status: 'dropped' }] });
    expect(await screen.findByText(/Enroll in this course/i)).toBeInTheDocument();
  });

  it('active enrollment: opens the first lesson and shows progress', async () => {
    setup({ user: { id: 5, role: 'student' }, enrollments: [{ course_id: 7, enrollment_id: 1, enrollment_status: 'active' }] });
    expect(await screen.findByText(/video-player https:\/\/cdn\/x\.mp4/)).toBeInTheDocument();
    expect(screen.getByText(/0 of 2 lessons/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/progress/1');
  });

  it('active enrollment: resumes at the first unfinished lesson (a PDF) and offers no next lesson', async () => {
    setup({
      user: { id: 5, role: 'student' },
      enrollments: [{ course_id: 7, enrollment_id: 1, enrollment_status: 'completed' }],
      progress: [{ content_id: 100, completed: true, watch_duration: 60, last_accessed_at: '2026-10-01' }],
    });
    expect(await screen.findByText(/reading-lesson Cheat sheet/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 lessons/)).toBeInTheDocument();
    expect(screen.queryByText(/Next lesson/)).not.toBeInTheDocument();
  });

  it('course owner can open the player without an enrollment (and no progress call)', async () => {
    setup({ user: { id: 20, role: 'instructor' } });
    expect(await screen.findByText(/video-player/)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/progress\//));
  });

  it('admin can open the player without an enrollment', async () => {
    setup({ user: { id: 1, role: 'admin' } });
    expect(await screen.findByText(/video-player/)).toBeInTheDocument();
  });

  it('another instructor is sent back to the course page', async () => {
    setup({ user: { id: 21, role: 'instructor' } });
    expect(await screen.findByText(/course page notice/)).toBeInTheDocument();
  });
});

describe('CoursePlayer lesson list', () => {
  const active = { course_id: 7, enrollment_id: 1, enrollment_status: 'active' };

  it('exposes overall progress as a progressbar and counts done lessons per module', async () => {
    setup({
      user: { id: 5, role: 'student' },
      enrollments: [active],
      progress: [{ content_id: 100, completed: true, watch_duration: 60, last_accessed_at: '2026-10-01' }],
    });
    const bar = await screen.findByRole('progressbar', { name: 'Course progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuetext', '1 of 2 lessons completed');
    expect(screen.getByText('1/2 done')).toBeInTheDocument();
  });

  it('marks the open lesson with aria-current and moves on with the Next lesson button', async () => {
    const user = userEvent.setup();
    setup({ user: { id: 5, role: 'student' }, enrollments: [active] });
    expect(await screen.findByText(/video-player/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1\. Welcome/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /2\. Cheat sheet/ })).not.toHaveAttribute('aria-current');

    await user.click(screen.getByRole('button', { name: /Next lesson: Cheat sheet/ }));
    expect(await screen.findByText(/reading-lesson Cheat sheet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2\. Cheat sheet/ })).toHaveAttribute('aria-current', 'true');
  });
});
