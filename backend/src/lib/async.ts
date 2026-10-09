import type { NextFunction, Request, Response } from 'express';

export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function wrap(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
