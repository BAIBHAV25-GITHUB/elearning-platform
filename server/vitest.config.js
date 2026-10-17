import { defineConfig } from 'vitest/config';

// Integration tests run the real Express app (supertest) against a throw-away PostgreSQL database that
// tests/globalSetup.js rebuilds from ../database before the run. Point TEST_DATABASE_URL at an EMPTY/disposable
// database: it is wiped on every run. Never aim it at development or production data.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/elearning_test';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/globalSetup.js'],
    setupFiles: ['tests/setup.js'],
    // one shared database: run files one after another so fixtures never race
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      TEST_DATABASE_URL,
      JWT_SECRET: 'test-secret-test-secret-test-secret',
      RAZORPAY_KEY_ID: 'rzp_test_key',
      RAZORPAY_KEY_SECRET: 'test_key_secret',
      RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret',
      AUTH_RATE_LIMIT: '100000',
      API_RATE_LIMIT: '100000',
      CLIENT_URL: 'http://localhost:5173',
    },
  },
});
