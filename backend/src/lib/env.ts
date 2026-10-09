function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required('DATABASE_URL'),
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  accessTtl: process.env.ACCESS_TTL ?? '15m',
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 7),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  appUrl: process.env.APP_URL ?? 'http://localhost:8080',
  businessTz: process.env.BUSINESS_TZ ?? 'Asia/Kolkata',
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
