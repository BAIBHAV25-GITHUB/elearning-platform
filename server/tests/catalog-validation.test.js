import { describe, it, expect, beforeAll } from 'vitest';
import { api, bearer, login, SEED, registerStudent, createCourse, enroll } from './helpers.js';

let john;
beforeAll(async () => {
  john = await login(SEED.john);
});

const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const expect400 = (res, message) => {
  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({ success: false, message });
};

describe('batch validation', () => {
  const post = (courseId, body, token = john) =>
    api.post(`/api/v1/courses/${courseId}/batches`).set(bearer(token)).send(body);
  const good = () => ({ batchName: '  Evening  ', startDate: future(10), endDate: future(40), maxCapacity: '12' });

  it('creates a batch: name trimmed, capacity may be a numeric string', async () => {
    const c = await createCourse();
    const res = await post(c.courseId, good());
    expect(res.status).toBe(201);
    expect(res.body.batch).toMatchObject({ batch_name: 'Evening', max_capacity: 12 });
  });

  it.each([
    [{ batchName: '' }, 'batchName is required (max 100 characters)'],
    [{ batchName: 'x'.repeat(101) }, 'batchName is required (max 100 characters)'],
    [{ batchName: 5 }, 'batchName is required (max 100 characters)'],
    [{ startDate: '10/11/2026' }, 'startDate and endDate must be YYYY-MM-DD'],
    [{ endDate: undefined }, 'startDate and endDate must be YYYY-MM-DD'],
    [{ maxCapacity: undefined }, 'All batch parameters are required'],
    [{ maxCapacity: 0 }, 'maxCapacity must be an integer BETWEEN 1 AND 30'],
    [{ maxCapacity: 31 }, 'maxCapacity must be an integer BETWEEN 1 AND 30'],
    [{ maxCapacity: 2.5 }, 'maxCapacity must be an integer BETWEEN 1 AND 30'],
    [{ maxCapacity: 'many' }, 'maxCapacity must be an integer BETWEEN 1 AND 30'],
    [{ startDate: future(40), endDate: future(10) }, 'startDate must be earlier than endDate'],
  ])('rejects %j', async (override, message) => {
    const c = await createCourse();
    expect400(await post(c.courseId, { ...good(), ...override }), message);
  });

  it('PATCH: empty body, bad status, bad capacity, then a valid edit', async () => {
    const c = await createCourse();
    const url = `/api/v1/courses/${c.courseId}/batches/${c.batchId}`;
    const patch = (body) => api.patch(url).set(bearer(john)).send(body);
    expect400(await patch({}), 'Nothing to update');
    expect400(await patch({ status: 'archived' }), "status must be 'open' or 'closed'");
    expect400(await patch({ maxCapacity: 99 }), 'maxCapacity must be an integer BETWEEN 1 AND 30');
    expect400(await patch({ startDate: 'soon' }), 'startDate must be YYYY-MM-DD');
    const ok = await patch({ batchName: ' Renamed ', maxCapacity: 7 });
    expect(ok.status).toBe(200);
    expect(ok.body.batch).toMatchObject({ batch_name: 'Renamed', max_capacity: 7 });
  });

  it('a student still cannot create a batch (role check runs before validation)', async () => {
    const s = await registerStudent();
    const c = await createCourse();
    expect((await post(c.courseId, good(), s.token)).status).toBe(403);
  });
});

describe('module validation', () => {
  const base = (courseId) => `/api/v1/courses/${courseId}/modules`;

  it('creates a module (title trimmed, description optional) and auto-numbers it', async () => {
    const c = await createCourse();
    const res = await api.post(base(c.courseId)).set(bearer(john)).send({ title: '  Intro  ', description: 42 });
    expect(res.status).toBe(201);
    expect(res.body.module.title).toBe('Intro');
    expect(res.body.module.sequence_no).toBe(2); // createCourse already made module 1
  });

  it.each([
    [{}, 'Module title is required (max 200 characters)'],
    [{ title: '   ' }, 'Module title is required (max 200 characters)'],
    [{ title: 'x'.repeat(201) }, 'Module title is required (max 200 characters)'],
    [{ title: 'ok', sequenceNo: 0 }, 'Sequence number must be a positive integer'],
    [{ title: 'ok', sequenceNo: 'first' }, 'Sequence number must be a positive integer'],
    [{ title: 'ok', sequenceNo: 40000 }, 'Sequence number must be a positive integer'],
  ])('rejects create %j', async (body, message) => {
    const c = await createCourse();
    expect400(await api.post(base(c.courseId)).set(bearer(john)).send(body), message);
  });

  it('PATCH: nothing to update, description must be text, valid edit', async () => {
    const c = await createCourse();
    const url = `${base(c.courseId)}/${c.moduleId}`;
    const patch = (body) => api.patch(url).set(bearer(john)).send(body);
    expect400(await patch({}), 'Nothing to update');
    expect400(await patch({ description: 5 }), 'Description must be text');
    expect400(await patch({ title: '' }), 'Module title is required (max 200 characters)');
    const ok = await patch({ title: ' New title ', description: '   ' });
    expect(ok.status).toBe(200);
    expect(ok.body.module).toMatchObject({ title: 'New title', description: null });
  });

  it('reorder: validates the id list, accepts a valid one', async () => {
    const c = await createCourse();
    const put = (body) => api.put(`${base(c.courseId)}/order`).set(bearer(john)).send(body);
    expect400(await put({}), 'moduleIds must be a list of module ids');
    expect400(await put({ moduleIds: [] }), 'moduleIds must be a list of module ids');
    expect400(await put({ moduleIds: [1, 1] }), 'moduleIds must be unique, valid module ids');
    expect400(await put({ moduleIds: ['a'] }), 'moduleIds must be unique, valid module ids');
    const ok = await put({ moduleIds: [c.moduleId] });
    expect(ok.status).toBe(200);
    expect(ok.body.modules).toHaveLength(1);
  });

  it('reorder: swaps two modules (regression: fn_reorder_modules used to fail with HTTP 500)', async () => {
    const c = await createCourse();
    const second = await api.post(base(c.courseId)).set(bearer(john)).send({ title: 'Second' });
    expect(second.status).toBe(201);
    const ids = [second.body.module.module_id, c.moduleId];
    const res = await api.put(`${base(c.courseId)}/order`).set(bearer(john)).send({ moduleIds: ids });
    expect(res.status).toBe(200);
    expect(res.body.modules.map((m) => m.module_id)).toEqual(ids);
    expect(res.body.modules.map((m) => m.sequence_no)).toEqual([1, 2]);
    // leaving a module out is refused by the database rule
    const partial = await api.put(`${base(c.courseId)}/order`).set(bearer(john)).send({ moduleIds: [c.moduleId] });
    expect400(partial, 'The new order must list every module of this course exactly once');
  });
});

describe('comment validation', () => {
  it('rejects empty / oversized content and a malformed parentCommentId; "" means no parent', async () => {
    const s = await registerStudent();
    const c = await createCourse();
    await enroll(s.token, c);
    const url = `/api/v1/modules/${c.moduleId}/comments`;
    const post = (body) => api.post(url).set(bearer(s.token)).send(body);

    expect400(await post({}), 'Comment must be 1-2000 characters.');
    expect400(await post({ content: '   ' }), 'Comment must be 1-2000 characters.');
    expect400(await post({ content: 'x'.repeat(2001) }), 'Comment must be 1-2000 characters.');
    expect400(await post({ content: 'hi', parentCommentId: 'abc' }), 'Invalid parentCommentId.');
    expect400(await post({ content: 'hi', parentCommentId: 0 }), 'Invalid parentCommentId.');

    const ok = await post({ content: '  hello  ', parentCommentId: '' });
    expect(ok.status).toBe(201);
    expect(ok.body.comment).toMatchObject({ content: 'hello', parent_comment_id: null });
  });

  it('keeps the rules that need the database: unknown parent -> 404', async () => {
    const s = await registerStudent();
    const c = await createCourse();
    await enroll(s.token, c);
    const res = await api
      .post(`/api/v1/modules/${c.moduleId}/comments`)
      .set(bearer(s.token))
      .send({ content: 'hi', parentCommentId: 999999 });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Parent comment not found.');
  });
});

describe('payment validation', () => {
  it('create-order: needs a valid enrollmentId', async () => {
    const s = await registerStudent();
    const post = (body) => api.post('/api/v1/payments/create-order').set(bearer(s.token)).send(body);
    expect400(await post({}), 'A valid enrollmentId is required');
    expect400(await post({ enrollmentId: 'x' }), 'A valid enrollmentId is required');
    expect400(await post({ enrollmentId: -3 }), 'A valid enrollmentId is required');
  });

  it('verify: needs all three gateway fields as non-empty strings', async () => {
    const s = await registerStudent();
    const post = (body) => api.post('/api/v1/payments/verify').set(bearer(s.token)).send(body);
    const msg = 'razorpayOrderId, razorpayPaymentId and razorpaySignature are required';
    expect400(await post({}), msg);
    expect400(await post({ razorpayOrderId: 'o', razorpayPaymentId: 'p' }), msg);
    expect400(await post({ razorpayOrderId: 'o', razorpayPaymentId: '', razorpaySignature: 's' }), msg);
    expect400(await post({ razorpayOrderId: 1, razorpayPaymentId: 'p', razorpaySignature: 's' }), msg);
    // a well-formed body gets past validation and fails on the signature instead
    const bad = await post({ razorpayOrderId: 'o', razorpayPaymentId: 'p', razorpaySignature: 's' });
    expect400(bad, 'Invalid payment signature verification');
  });
});
