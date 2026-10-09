import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

export function validateBody(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.parse(req.body ?? {});
    req.body = parsed;
    next();
  };
}

export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.parse(req.query);
    (req as Request & { parsedQuery: unknown }).parsedQuery = parsed;
    next();
  };
}

export function queryOf<T>(req: Request): T {
  return (req as Request & { parsedQuery: T }).parsedQuery;
}
