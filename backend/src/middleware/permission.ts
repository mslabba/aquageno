import type { NextFunction, Request, Response } from 'express';
import { hasPerm, type ActionName, type ModuleName } from '../lib/permissions';
import { forbidden } from '../lib/errors';
import { currentUser } from './auth';

export function requirePerm(module: ModuleName, action: ActionName) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = currentUser(req);
    if (!hasPerm(user.permissions, module, action)) {
      next(forbidden(`Your role cannot ${action.toLowerCase()} ${module.replaceAll('_', ' ').toLowerCase()}.`));
      return;
    }
    next();
  };
}

export function requireAll(checks: Array<[ModuleName, ActionName]>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = currentUser(req);
    for (const [module, action] of checks) {
      if (!hasPerm(user.permissions, module, action)) {
        next(forbidden(`Your role cannot ${action.toLowerCase()} ${module.replaceAll('_', ' ').toLowerCase()}.`));
        return;
      }
    }
    next();
  };
}
