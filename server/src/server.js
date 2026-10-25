import { env } from './config/env.js'; // must stay the first import: loads + validates .env
import app from './app.js';
import { closePool } from './config/db.js';
import { logger } from './utils/logger.js';
import { expirePendingEnrollmentsInDb } from './repositories/enrollment.repository.js';
import { closeEndedBatchesInDb } from './repositories/batch.repository.js';
import { failStuckVideos } from './repositories/content.repository.js';

const server = app.listen(env.port, () => {
  logger.info(`Server running in ${env.nodeEnv} mode on port ${env.port}`);
});

// Video processing jobs live in memory: after a restart, videos that were mid-processing can never finish.
failStuckVideos()
  .then((n) => n > 0 && logger.info(`Marked ${n} unfinished video(s) as failed (server restarted)`))
  .catch((err) => logger.error('Could not reset unfinished videos', { err: err.message }));

// Big video uploads take longer than Node's default 5-minute request timeout.
server.requestTimeout = 60 * 60 * 1000;

// Free seats held by unpaid PENDING enrollments (F4). Runs every 5 minutes.
const expiryTimer = setInterval(async () => {
  try {
    const expired = await expirePendingEnrollmentsInDb(env.pendingEnrollmentMinutes);
    if (expired > 0) logger.info(`Expired ${expired} unpaid pending enrollment(s)`);
    const closed = await closeEndedBatchesInDb();
    if (closed > 0) logger.info(`Closed ${closed} ended batch(es)`);
  } catch (err) {
    logger.error('Maintenance job failed', { err: err.message });
  }
}, 5 * 60 * 1000);
expiryTimer.unref();

// Graceful shutdown (SIGTERM from Docker / the platform, Ctrl+C locally): stop taking new requests, let the
// running ones finish, release the database connections, then exit. A watchdog forces the exit if something hangs
// (e.g. a long video upload) so a deploy is never blocked forever.
let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  clearInterval(expiryTimer);
  setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, 15_000).unref();
  server.close(async () => {
    try {
      await closePool();
    } catch (err) {
      logger.error('Error while closing the database pool', { err: err.message });
    }
    process.exit(0);
  });
  server.closeIdleConnections?.();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
