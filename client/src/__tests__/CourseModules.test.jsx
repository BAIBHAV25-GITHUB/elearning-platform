import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import CourseModules, { POLL_MS } from '../pages/instructor/CourseModules';
import api from '../api/axios';
import { getCourseModulesApi } from '../services/module.service';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../services/module.service', () => ({
  getCourseModulesApi: vi.fn(),
  createModuleApi: vi.fn(),
  deleteContentApi: vi.fn(),
  updateModuleApi: vi.fn(),
  reorderModulesApi: vi.fn(),
  deleteModuleApi: vi.fn(),
}));
vi.mock('../components/instructor/CourseTools', () => ({ default: () => null }));
vi.mock('../components/instructor/BatchManager', () => ({ default: () => null }));

const mod = (contents = []) => ({
  modules: [{ module_id: 7, sequence_no: 1, title: 'Basics', description: '', contents }],
});
const lesson = (status, extra = {}) => ({
  content_id: 1,
  sequence_no: 1,
  title: 'Intro video',
  type: 'video',
  status,
  ...extra,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/instructor/courses/3/modules']}>
      <Routes>
        <Route path="/instructor/courses/:courseId/modules" element={<CourseModules />} />
      </Routes>
    </MemoryRouter>
  );

// jsdom keeps treating the `required` file input as empty after user.upload, which blocks a real click on the
// submit button; browsers don't. Submitting the form directly skips only that native validation.
const submitUpload = () => fireEvent.submit(screen.getByLabelText('Content Title').closest('form'));

const openUploadForm = async (user) => {
  await user.click(await screen.findByRole('button', { name: /add video/i }));
  await user.type(screen.getByLabelText('Content Title'), 'Lesson 1');
  await user.upload(screen.getByLabelText('Select File'), new File(['x'], 'v.mp4', { type: 'video/mp4' }));
};

describe('CourseModules upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCourseModulesApi.mockResolvedValue(mod());
  });

  it('cancels an upload with the abort signal, keeps the form, and retries', async () => {
    const user = userEvent.setup();
    let signal;
    api.post.mockImplementationOnce(
      (_url, _body, cfg) =>
        new Promise((_, reject) => {
          signal = cfg.signal;
          cfg.signal.addEventListener('abort', () => reject({ code: 'ERR_CANCELED', name: 'CanceledError' }));
        })
    );
    renderPage();
    await openUploadForm(user);
    submitUpload();

    expect(await screen.findByRole('progressbar', { name: 'Upload progress' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel upload' }));

    expect(signal.aborted).toBe(true);
    expect(await screen.findByText(/upload cancelled/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Content Title')).toHaveValue('Lesson 1'); // nothing was lost
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // a cancel is not an error

    expect(screen.getByRole('button', { name: 'Retry upload' })).toBeEnabled();
    api.post.mockResolvedValueOnce({ data: { success: true } });
    submitUpload(); // same as pressing "Retry upload"
    await waitFor(() => expect(screen.queryByLabelText('Content Title')).not.toBeInTheDocument()); // form closes on success
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it('offers a retry after a failed upload and keeps the file and title', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValueOnce({ response: { data: { message: 'Network hiccup' } } });
    renderPage();
    await openUploadForm(user);
    submitUpload();

    expect(await screen.findByRole('alert')).toHaveTextContent('Network hiccup');
    expect(screen.getByLabelText('Content Title')).toHaveValue('Lesson 1');
    expect(screen.getByRole('button', { name: 'Retry upload' })).toBeEnabled();
  });
});

describe('CourseModules processing status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  });
  afterEach(() => vi.useRealTimers());

  const tick = async (ms) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it('polls a processing lesson until it is ready, and announces it', async () => {
    getCourseModulesApi
      .mockResolvedValueOnce(mod([lesson('processing')]))
      .mockResolvedValueOnce(mod([lesson('processing')]))
      .mockResolvedValue(mod([lesson('ready', { duration_sec: 600 })]));
    renderPage();
    await tick(1); // first load
    expect(screen.getByText('Processing')).toBeInTheDocument();

    await tick(POLL_MS);
    expect(screen.getByText('Processing')).toBeInTheDocument();
    await tick(POLL_MS);
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('10 min')).toBeInTheDocument();
    expect(screen.getByText('"Intro video" is ready.')).toBeInTheDocument();

    const calls = getCourseModulesApi.mock.calls.length;
    await tick(POLL_MS * 3); // nothing is busy any more: no further requests
    expect(getCourseModulesApi.mock.calls.length).toBe(calls);
  });

  it('shows a failed lesson with its reason and stops polling', async () => {
    getCourseModulesApi
      .mockResolvedValueOnce(mod([lesson('processing')]))
      .mockResolvedValue(mod([lesson('error', { error_message: 'Unsupported codec' })]));
    renderPage();
    await tick(1);
    await tick(POLL_MS);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Unsupported codec')).toBeInTheDocument();
    expect(screen.getByText('"Intro video" failed to process.')).toBeInTheDocument();
  });

  it('does not poll while the tab is hidden', async () => {
    getCourseModulesApi.mockResolvedValue(mod([lesson('processing')]));
    renderPage();
    await tick(1);
    const before = getCourseModulesApi.mock.calls.length;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    await tick(POLL_MS * 2);
    expect(getCourseModulesApi.mock.calls.length).toBe(before);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    await tick(POLL_MS);
    expect(getCourseModulesApi.mock.calls.length).toBeGreaterThan(before);
  });
});
