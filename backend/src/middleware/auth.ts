import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { grantsToSet } from '../lib/permissions';
import { verifyAccessToken } from '../lib/tokens';
import type { AuthUser } from '../types';

const PASSWORD_CHANGE_ALLOW = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/change-password',
  '/api/v1/auth/logout',
  '/api/v1/auth/refresh',
]);

export async function loadUser(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { permissions: true } } },
  });
  if (!user || user.deletedAt || !user.isActive || !user.role.isActive || user.role.deletedAt) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    tokenVersion: user.tokenVersion,
    mustChangePassword: user.mustChangePassword,
    isActive: user.isActive,
    roleId: user.roleId,
    roleName: user.role.name,
    permissions: grantsToSet(user.role.permissions),
  };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new AppError('UNAUTHORIZED', 'Sign in to continue.', 401);
    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch {
      throw new AppError('UNAUTHORIZED', 'Your session expired. Sign in again.', 401);
    }
    const user = await loadUser(claims.sub);
    if (!user || user.tokenVersion !== claims.tv) {
      throw new AppError('UNAUTHORIZED', 'Your session is no longer valid. Sign in again.', 401);
    }
    if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOW.has(req.originalUrl.split('?')[0])) {
      throw new AppError(
        'PASSWORD_CHANGE_REQUIRED',
        'Set a new password before using the rest of the system.',
        403,
      );
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new AppError('UNAUTHORIZED', 'Sign in to continue.', 401);
  return req.user;
}
