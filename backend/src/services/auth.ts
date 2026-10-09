import type { Response } from 'express';
import { env } from '../lib/env';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { hashPassword, verifyPassword } from '../lib/password';
import { ACTIONS, MODULES, hasPerm } from '../lib/permissions';
import { accessTtlSeconds, hashSecret, newSecret, signAccessToken } from '../lib/tokens';
import { mailer } from '../lib/mailer';
import { writeAudit } from '../lib/audit';
import { loadUser } from '../middleware/auth';
import type { AuthUser } from '../types';

const COOKIE = 'ag_refresh';

export function publicUser(user: AuthUser) {
  const permissions: Record<string, string[]> = {};
  for (const module of MODULES) {
    permissions[module] = ACTIONS.filter((action) => hasPerm(user.permissions, module, action));
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    mustChangePassword: user.mustChangePassword,
    role: { id: user.roleId, name: user.roleName },
    permissions,
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: env.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(COOKIE, { path: '/api/v1/auth' });
}

export function readRefreshCookie(reqCookies: Record<string, string | undefined>, bodyToken?: string): string {
  return reqCookies[COOKIE] || bodyToken || '';
}

async function issueRefresh(userId: string): Promise<string> {
  const token = newSecret();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashSecret(token),
      expiresAt: new Date(Date.now() + env.refreshTtlDays * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

export async function sessionFor(user: AuthUser) {
  const refreshToken = await issueRefresh(user.id);
  return {
    accessToken: signAccessToken(user.id, user.tokenVersion),
    expiresIn: accessTtlSeconds(),
    refreshToken,
    user: publicUser(user),
  };
}

export async function login(email: string, password: string) {
  const record = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!record || record.deletedAt || !record.isActive) {
    throw new AppError('UNAUTHORIZED', 'Email or password is incorrect.', 401);
  }
  const ok = await verifyPassword(password, record.passwordHash);
  if (!ok) throw new AppError('UNAUTHORIZED', 'Email or password is incorrect.', 401);
  const user = await loadUser(record.id);
  if (!user) throw new AppError('UNAUTHORIZED', 'Email or password is incorrect.', 401);
  await writeAudit(prisma, {
    userId: user.id,
    action: 'LOGIN',
    entityType: 'USER',
    entityId: user.id,
    summary: `${user.name} signed in`,
  });
  return sessionFor(user);
}

export async function rotate(rawToken: string) {
  if (!rawToken) throw new AppError('UNAUTHORIZED', 'Sign in to continue.', 401);
  const tokenHash = hashSecret(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing) throw new AppError('UNAUTHORIZED', 'Sign in to continue.', 401);
  if (existing.revokedAt || existing.expiresAt.getTime() <= Date.now()) {
    await prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError('UNAUTHORIZED', 'That session was already used. Sign in again.', 401);
  }
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count !== 1) {
    await prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError('UNAUTHORIZED', 'That session was already used. Sign in again.', 401);
  }
  const user = await loadUser(existing.userId);
  if (!user) throw new AppError('UNAUTHORIZED', 'Sign in to continue.', 401);
  const refreshToken = await issueRefresh(user.id);
  const created = await prisma.refreshToken.findUnique({ where: { tokenHash: hashSecret(refreshToken) } });
  if (created) {
    await prisma.refreshToken.update({ where: { id: existing.id }, data: { replacedById: created.id } });
  }
  return {
    accessToken: signAccessToken(user.id, user.tokenVersion),
    expiresIn: accessTtlSeconds(),
    refreshToken,
    user: publicUser(user),
  };
}

export async function logout(rawToken: string, userId?: string) {
  if (rawToken) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashSecret(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  if (userId) {
    await writeAudit(prisma, {
      userId,
      action: 'LOGOUT',
      entityType: 'USER',
      entityId: userId,
      summary: 'Signed out',
    });
  }
}

export async function changePassword(user: AuthUser, currentPassword: string, newPassword: string) {
  const record = await prisma.user.findUnique({ where: { id: user.id } });
  if (!record) throw new AppError('UNAUTHORIZED', 'Sign in to continue.', 401);
  const ok = await verifyPassword(currentPassword, record.passwordHash);
  if (!ok) throw new AppError('UNAUTHORIZED', 'Current password is incorrect.', 401);
  if (await verifyPassword(newPassword, record.passwordHash)) {
    throw new AppError('VALIDATION_ERROR', 'Choose a password that is different from the current one.', 400);
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
      },
    });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'PASSWORD_CHANGE',
      entityType: 'USER',
      entityId: user.id,
      summary: `${user.name} changed their password`,
    });
  });
  const fresh = await loadUser(user.id);
  if (!fresh) throw new AppError('UNAUTHORIZED', 'Sign in to continue.', 401);
  return sessionFor(fresh);
}

export async function forgotPassword(email: string) {
  const record = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!record || record.deletedAt || !record.isActive) return;
  const token = newSecret();
  await prisma.passwordResetToken.create({
    data: {
      userId: record.id,
      tokenHash: hashSecret(token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  const link = `${env.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await mailer.send({
    to: record.email,
    subject: 'Reset your Aquageno password',
    text: `Use this link within 30 minutes to set a new password:\n${link}\n\nIf you did not ask for this, ignore the message.`,
  });
}

export async function resetPassword(token: string, newPassword: string) {
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashSecret(token) } });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
    throw new AppError('VALIDATION_ERROR', 'That reset link is invalid or has expired.', 400);
  }
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await tx.user.update({
      where: { id: row.userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
      },
    });
    await tx.refreshToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit(tx, {
      userId: row.userId,
      action: 'PASSWORD_CHANGE',
      entityType: 'USER',
      entityId: row.userId,
      summary: 'Password reset from a recovery link',
    });
  });
}
