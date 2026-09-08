import app from './app.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`[SERVER] Running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log(`[HEALTH] Endpoint available at http://localhost:${PORT}/api/v1/health`);
});

process.on('unhandledRejection', (err) => {
  console.error('[ERROR] Unhandled Rejection:', err);
  server.close(() => process.exit(1));
});