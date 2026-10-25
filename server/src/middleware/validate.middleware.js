// Route-level input validation with zod, so the rules live in src/validation/* (one place, reusable by tests)
// instead of hand-written if-chains in every controller.
//
//   router.post('/login', validate(loginSchema), login)       -> parsed + trimmed data replaces req.body
//   router.get('/x', validate(listSchema, 'query'), handler)  -> parsed data is available as req.valid.query
//
// A failure answers 400 { success: false, message, errors: [{ path, message }] }; message is the first problem so
// the client can show it as-is.
export const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    const errors = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return res.status(400).json({ success: false, message: errors[0]?.message || 'Invalid input', errors });
  }
  req.valid = { ...(req.valid || {}), [source]: result.data };
  if (source === 'body') req.body = result.data; // Express 5: req.query is read-only, req.body is not
  return next();
};
