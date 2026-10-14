import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import authRoutes from './routes/auth.routes.js';
import courseRoutes from './routes/course.routes.js';
import moduleRoutes from './routes/module.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import batchRoutes from './routes/batch.routes.js';
import enrollmentRoutes from './routes/enrollment.routes.js';
import progressRoutes from './routes/progress.routes.js';
import certificateRoutes from './routes/certificate.routes.js';
import commentRoutes from './routes/comment.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import announcementRoutes from './routes/announcement.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import { handleWebhook } from './controllers/payment.controller.js';
import { auditMiddleware } from './middleware/audit.middleware.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';

const app = express();

// needed so req.ip (rate limiting, audit log) is correct behind a reverse proxy
app.set('trust proxy', env.trustProxy);

app.use(helmet());
app.use(cors({ origin: env.clientUrls }));

// Razorpay webhook: must see the RAW body to verify the signature, so it is
// registered before the JSON parser (S0d).
app.post('/api/v1/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), handleWebhook);

// One JSON parser only (the duplicate registration was removed)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Audit logging has to wrap res.json BEFORE the routers respond (it used to be mounted after them, so it never ran)
app.use('/api/v1/courses', auditMiddleware('courses'));
app.use('/api/v1/enrollments', auditMiddleware('enrollments'));

// Everything lives under /api/v1
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/payments', paymentRoutes);
// nested routers first, then the course router (S0b)
app.use('/api/v1/courses/:courseId/modules', moduleRoutes);
app.use('/api/v1/courses/:courseId/batches', batchRoutes);
app.use('/api/v1/courses', courseRoutes);
app.use('/api/v1/enrollments', enrollmentRoutes);
app.use('/api/v1/progress', progressRoutes); // was imported but never mounted (S0a)
app.use('/api/v1/certificates', certificateRoutes); // was imported but never mounted (S0a)
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1', commentRoutes); // /modules/:id/comments
app.use('/api/v1', announcementRoutes); // /courses/:id/announcements

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
