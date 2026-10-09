import { Router } from 'express';
import { z } from 'zod';
import { wrap } from '../lib/async';
import { sendData } from '../lib/http';
import { requireAuth, currentUser } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { changePasswordSchema, forgotSchema, loginSchema, resetSchema } from '../lib/validators';
import * as auth from '../services/auth';

export const authRouter = Router();

authRouter.post(
  '/login',
  validateBody(loginSchema),
  wrap(async (req, res) => {
    const session = await auth.login(req.body.email, req.body.password);
    auth.setRefreshCookie(res, session.refreshToken);
    sendData(res, session);
  }),
);

authRouter.post(
  '/refresh',
  wrap(async (req, res) => {
    const body = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    const token = auth.readRefreshCookie(req.cookies ?? {}, body.refreshToken);
    const session = await auth.rotate(token);
    auth.setRefreshCookie(res, session.refreshToken);
    sendData(res, session);
  }),
);

authRouter.post(
  '/logout',
  wrap(async (req, res) => {
    const body = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    const token = auth.readRefreshCookie(req.cookies ?? {}, body.refreshToken);
    let userId: string | undefined;
    const header = req.header('authorization') ?? '';
    if (header.startsWith('Bearer ')) {
      try {
        await requireAuth(req, res, () => undefined);
        userId = req.user?.id;
      } catch {
        userId = undefined;
      }
    }
    await auth.logout(token, userId);
    auth.clearRefreshCookie(res);
    sendData(res, { ok: true });
  }),
);

authRouter.post(
  '/forgot-password',
  validateBody(forgotSchema),
  wrap(async (req, res) => {
    await auth.forgotPassword(req.body.email);
    sendData(res, { message: 'If that email is on file, a reset link has been issued.' });
  }),
);

authRouter.post(
  '/reset-password',
  validateBody(resetSchema),
  wrap(async (req, res) => {
    await auth.resetPassword(req.body.token, req.body.newPassword);
    sendData(res, { message: 'Password updated. Sign in with the new password.' });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    sendData(res, auth.publicUser(currentUser(req)));
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  wrap(async (req, res) => {
    const session = await auth.changePassword(currentUser(req), req.body.currentPassword, req.body.newPassword);
    auth.setRefreshCookie(res, session.refreshToken);
    sendData(res, session);
  }),
);
