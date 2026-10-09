import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from './env';

export type AccessClaims = { sub: string; tv: number };

export function signAccessToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ sub: userId, tv: tokenVersion }, env.jwtAccessSecret, {
    expiresIn: env.accessTtl as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const payload = jwt.verify(token, env.jwtAccessSecret);
  if (!payload || typeof payload === 'string' || !payload.sub || typeof payload.tv !== 'number') {
    throw new Error('Invalid access token');
  }
  return { sub: payload.sub, tv: payload.tv };
}

export function newSecret(): string {
  return crypto.randomBytes(48).toString('base64url');
}

export function hashSecret(token: string): string {
  return crypto.createHmac('sha256', env.jwtRefreshSecret).update(token).digest('hex');
}

export function accessTtlSeconds(): number {
  const raw = env.accessTtl;
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) return 900;
  const n = Number(match[1]);
  const unit = match[2];
  if (unit === 's') return n;
  if (unit === 'm') return n * 60;
  if (unit === 'h') return n * 3600;
  return n * 86400;
}
