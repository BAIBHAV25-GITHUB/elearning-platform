import dotenv from 'dotenv';

// Single place where .env is loaded and validated. Every module that needs
// configuration imports this file, so it no longer depends on which module
// happens to call dotenv.config() first (S0f).
dotenv.config();

const e = process.env;

// .env.example documents DATABASE_URL, but the older DB_* variables still work.
if (!e.DATABASE_URL && e.DB_HOST && e.DB_NAME && e.DB_USER) {
  const auth = `${encodeURIComponent(e.DB_USER)}:${encodeURIComponent(e.DB_PASSWORD || '')}`;
  e.DATABASE_URL = `postgres://${auth}@${e.DB_HOST}:${e.DB_PORT || 5432}/${e.DB_NAME}`;
}

const problems = [];
if (!e.DATABASE_URL) {
  problems.push('DATABASE_URL is not set (e.g. postgres://postgres:postgres@localhost:5432/elearning_db)');
}
if (!e.JWT_SECRET || e.JWT_SECRET === 'change-me' || e.JWT_SECRET.length < 16) {
  problems.push(
    'JWT_SECRET is missing, still "change-me", or shorter than 16 characters. ' +
      'Generate one: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
}
if (problems.length) {
  throw new Error(`Invalid server configuration:\n - ${problems.join('\n - ')}`);
}

export const env = {
  nodeEnv: e.NODE_ENV || 'development',
  isProduction: e.NODE_ENV === 'production',
  isDevelopment: (e.NODE_ENV || 'development') === 'development',
  port: Number(e.PORT) || 5000,
  databaseUrl: e.DATABASE_URL,
  jwtSecret: e.JWT_SECRET,
  jwtExpiresIn: e.JWT_EXPIRES_IN || '7d',
  // comma separated list of allowed browser origins
  clientUrls: (e.CLIENT_URL || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  // set TRUST_PROXY=1 when running behind one reverse proxy (nginx, Render, ...)
  trustProxy: e.TRUST_PROXY ? (Number.isNaN(Number(e.TRUST_PROXY)) ? e.TRUST_PROXY : Number(e.TRUST_PROXY)) : false,
  authRateLimit: Number(e.AUTH_RATE_LIMIT) || 20,
  // general per-IP limit for every other /api route (requests per minute)
  apiRateLimit: Number(e.API_RATE_LIMIT) || 600,
  // Database TLS. Production defaults to a VERIFIED connection; set DB_SSL_REJECT_UNAUTHORIZED=false only for a
  // provider with a self-signed certificate, or DB_SSL=false when the database is on a private network without TLS.
  dbSsl: e.DB_SSL ? e.DB_SSL !== 'false' : e.NODE_ENV === 'production',
  dbSslRejectUnauthorized: e.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
  razorpayKeyId: e.RAZORPAY_KEY_ID,
  razorpayKeySecret: e.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: e.RAZORPAY_WEBHOOK_SECRET,
  pendingEnrollmentMinutes: Number(e.PENDING_ENROLLMENT_MINUTES) || 30,
  // Video uploads: one big file in, compressed and cut into pieces that fit Cloudinary's free-plan
  // 100 MB-per-video limit (see services/videoProcessing.service.js).
  maxVideoUploadMb: Number(e.MAX_VIDEO_UPLOAD_MB) || 4096,
  videoPartSeconds: Number(e.VIDEO_PART_SECONDS) || 600,
  videoMaxHeight: Number(e.VIDEO_MAX_HEIGHT) || 480,
  videoCrf: Number(e.VIDEO_CRF) || 30,
  videoMaxPartMb: Number(e.VIDEO_MAX_PART_MB) || 95,
  // Protected media: Cloudinary 'authenticated' files are served through signed URLs. Set the token key
  // (Cloudinary Enterprise / token-based authentication) to make those URLs expire after this many seconds.
  cloudinaryAuthTokenKey: e.CLOUDINARY_AUTH_TOKEN_KEY || '',
  mediaUrlTtlSeconds: Number(e.MEDIA_URL_TTL_SECONDS) || 3600,
};
