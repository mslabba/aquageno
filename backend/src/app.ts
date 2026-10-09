import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from './lib/env';
import { sendData, sendError } from './lib/http';
import { prisma } from './lib/prisma';
import { wrap } from './lib/async';
import { errorHandler } from './middleware/errorHandler';
import { requireAuth } from './middleware/auth';
import { authRouter } from './routes/auth';
import {
  adjustmentsRouter,
  approvalsRouter,
  auditRouter,
  bomsRouter,
  categoriesRouter,
  customersRouter,
  dashboardRouter,
  itemsRouter,
  notificationsRouter,
  productionsRouter,
  purchasesRouter,
  referenceRouter,
  reportsRouter,
  rolesRouter,
  shipmentsRouter,
  stockRouter,
  suppliersRouter,
  packingConfigsRouter,
  traceRouter,
  transfersRouter,
  unitsRouter,
  usersRouter,
  warehousesRouter,
} from './routes/api';

export const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigins,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

if (env.nodeEnv !== 'test') {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      data: null,
      error: { code: 'RATE_LIMIT', message: 'Too many attempts. Wait a few minutes and try again.', details: null },
      meta: null,
    },
  });
  app.use('/api/v1/auth/login', limiter);
  app.use('/api/v1/auth/forgot-password', limiter);
}

app.get(
  '/api/v1/health',
  wrap(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    sendData(res, { status: 'ok' });
  }),
);

app.use('/api/v1/auth', authRouter);
app.use('/api/v1', requireAuth);
app.use('/api/v1/reference', referenceRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/roles', rolesRouter);
app.use('/api/v1/units', unitsRouter);
app.use('/api/v1/categories', categoriesRouter);
app.use('/api/v1/warehouses', warehousesRouter);
app.use('/api/v1/suppliers', suppliersRouter);
app.use('/api/v1/customers', customersRouter);
app.use('/api/v1/items', itemsRouter);
app.use('/api/v1/boms', bomsRouter);
app.use('/api/v1/packing-configs', packingConfigsRouter);
app.use('/api/v1/trace', traceRouter);
app.use('/api/v1/purchases', purchasesRouter);
app.use('/api/v1/production', productionsRouter);
app.use('/api/v1/transfers', transfersRouter);
app.use('/api/v1/shipments', shipmentsRouter);
app.use('/api/v1/adjustments', adjustmentsRouter);
app.use('/api/v1/stock', stockRouter);
app.use('/api/v1/approvals', approvalsRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/audit-logs', auditRouter);
app.use('/api/v1/reports', reportsRouter);

app.use('/api', (_req, res) => {
  sendError(res, 404, 'NOT_FOUND', 'That API route does not exist.');
});

app.use(errorHandler);
