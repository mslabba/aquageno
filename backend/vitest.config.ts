import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-access-secret-must-be-long-enough',
      JWT_REFRESH_SECRET: 'test-refresh-secret-must-be-long-enough',
      ACCESS_TTL: '15m',
      REFRESH_TTL_DAYS: '7',
      BCRYPT_ROUNDS: '4',
      PORT: '0',
      CORS_ORIGIN: 'http://localhost:5173',
      COOKIE_SECURE: 'false',
      APP_URL: 'http://localhost:8080',
      BUSINESS_TZ: 'Asia/Kolkata',
      LOG_LEVEL: 'silent',
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgresql://aquageno:aquageno@localhost:5433/aquageno_test',
    },
  },
});
