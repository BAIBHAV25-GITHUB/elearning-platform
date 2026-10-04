import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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
import { auditMiddleware } from './middleware/audit.middleware.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/courses', courseRoutes);
app.use('/api/v1/courses/:courseId/modules', moduleRoutes);
app.use('/api/v1/courses/:courseId/batches', batchRoutes);
app.use('/api/v1/enrollments', enrollmentRoutes);
app.use('/api/v1', commentRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1', announcementRoutes);
app.use('/api/v1/courses', auditMiddleware('courses'));
app.use('/api/v1/enrollments', auditMiddleware('enrollments'));
app.use('/api/v1/users', auditMiddleware('users'));
app.use(errorHandler);

export default app;