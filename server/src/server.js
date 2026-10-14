import { env } from './config/env.js'; // must stay the first import: loads + validates .env
import app from './app.js';
import { expirePendingEnrollmentsInDb } from './repositories/enrollment.repository.js';
import { closeEndedBatchesInDb } from './repositories/batch.repository.js';
import { failStuckVideos } from './repositories/content.repository.js';

const server = app.listen(env.port, () => {
  console.log(`Server running in ${env.nodeEnv} mode on port ${env.port}`);
});

// Video processing jobs live in memory: after a restart, videos that were mid-processing can never finish.
failStuckVideos()
  .then((n) => n > 0 && console.log(`Marked ${n} unfinished video(s) as failed (server restarted)`))
  .catch((err) => console.error('Could not reset unfinished videos:', err.message));

// Big video uploads take longer than Node's default 5-minute request timeout.
server.requestTimeout = 60 * 60 * 1000;

// Free seats held by unpaid PENDING enrollments (F4). Runs every 5 minutes.
const expiryTimer = setInterval(async () => {
  try {
    const expired = await expirePendingEnrollmentsInDb(env.pendingEnrollmentMinutes);
    if (expired > 0) console.log(`Expired ${expired} unpaid pending enrollment(s)`);
    const closed = await closeEndedBatchesInDb();
    if (closed > 0) console.log(`Closed ${closed} ended batch(es)`);
  } catch (err) {
    console.error('Maintenance job failed:', err.message);
  }
}, 5 * 60 * 1000);
expiryTimer.unref();

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
