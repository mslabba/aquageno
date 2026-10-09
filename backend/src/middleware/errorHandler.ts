import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { sendError } from '../lib/http';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    sendError(res, err.status, err.code, err.message, err.details);
    return;
  }
  if (err instanceof ZodError) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Check the highlighted fields.', err.flatten());
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      sendError(res, 409, 'CONFLICT', 'A record with those details already exists.');
      return;
    }
    if (err.code === 'P2025') {
      sendError(res, 404, 'NOT_FOUND', 'That record was not found.');
      return;
    }
  }
  logger.error({ err, requestId: req.requestId, path: req.path }, 'unhandled error');
  sendError(res, 500, 'INTERNAL', 'Something went wrong while handling that request.');
}
