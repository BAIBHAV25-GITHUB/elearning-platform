import crypto from 'node:crypto';
import supertest from 'supertest';
import app from '../src/app.js';
import { query } from '../src/config/db.js';

export const api = supertest(app);
export { query };

export const PASSWORD = 'Password123!';
export const SEED = {
  admin: 'admin@elearning.com',
  john: 'john.doe@elearning.com', // instructor, approved
  sarah: 'sarah.smith@elearning.com', // instructor, approved
};

export const uid = () => crypto.randomBytes(5).toString('hex');
export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

export const login = async (email, password = PASSWORD) => {
  const res = await api.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
};

/** Registers a brand-new user through the real endpoint. */
export const registerUser = async ({ role, name = 'Test User' } = {}) => {
  const email = `u-${uid()}@test.dev`;
  const res = await api.post('/api/v1/auth/register').send({ name, email, password: PASSWORD, ...(role ? { role } : {}) });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { email, id: res.body.user.id, token: res.body.token, user: res.body.user };
};
export const registerStudent = () => registerUser({ name: 'Test Student' });

const userId = async (email) => (await query('SELECT user_id FROM users WHERE email = $1', [email])).rows[0].user_id;

/**
 * Inserts a course with one open batch, one module and the given lessons straight into the database
 * (fast, and independent of the course-authoring endpoints, which have their own rules).
 * contents: [{ type: 'text' | 'pdf' | 'video', durationSec? }]
 */
export const createCourse = async ({
  instructor = SEED.john,
  price = 0,
  status = 'published',
  capacity = 5,
  contents = [{ type: 'text' }],
} = {}) => {
  const instructorId = await userId(instructor);
  const course = (
    await query(
      `INSERT INTO courses (instructor_id, title, description, price, status)
       VALUES ($1, $2, 'test course', $3, $4::course_status_enum) RETURNING course_id`,
      [instructorId, `Test course ${uid()}`, price, status]
    )
  ).rows[0];
  const batch = (
    await query(
      `INSERT INTO batches (course_id, batch_name, start_date, end_date, max_capacity)
       VALUES ($1, 'Batch A', current_date + 30, current_date + 90, $2) RETURNING batch_id`,
      [course.course_id, capacity]
    )
  ).rows[0];
  const mod = (
    await query(
      `INSERT INTO content_modules (course_id, title, sequence_no) VALUES ($1, 'Module 1', 1) RETURNING module_id`,
      [course.course_id]
    )
  ).rows[0];
  const contentIds = [];
  for (const [i, c] of contents.entries()) {
    const row = (
      await query(
        `INSERT INTO content (module_id, title, type, sequence_no, status, text_body, video_url, duration_sec)
         VALUES ($1, $2, $3::content_type_enum, $4, 'ready', $5, $6, $7) RETURNING content_id`,
        [
          mod.module_id,
          `Lesson ${i + 1}`,
          c.type,
          i + 1,
          c.type === 'text' ? 'Some lesson text' : null,
          c.type === 'text' ? null : 'https://example.com/file',
          c.durationSec ?? null,
        ]
      )
    ).rows[0];
    contentIds.push(row.content_id);
  }
  return { courseId: course.course_id, batchId: batch.batch_id, moduleId: mod.module_id, contentIds };
};

export const enroll = (token, { courseId, batchId }) =>
  api.post('/api/v1/enrollments').set(bearer(token)).send({ courseId, batchId });

/** Body + header of a Razorpay webhook signed with the test webhook secret. */
export const signedWebhook = (event, secret = process.env.RAZORPAY_WEBHOOK_SECRET) => {
  const raw = JSON.stringify(event);
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return { raw, signature };
};
