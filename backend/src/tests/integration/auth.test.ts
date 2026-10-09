import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { mailer } from '../../lib/mailer';
import { auth, login, resetAndSeed, disconnect } from '../helpers';

beforeAll(async () => {
  await resetAndSeed();
});

afterAll(async () => {
  await disconnect();
});

function cookieFrom(res: request.Response) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const match = list.find((entry) => entry.startsWith('ag_refresh='));
  return match ? match.split(';')[0] : '';
}

describe('auth flow', () => {
  it('rejects a wrong password and signs in a known user', async () => {
    const bad = await login('meera.nair@aquageno.local', 'not-the-password');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('UNAUTHORIZED');

    const good = await login('meera.nair@aquageno.local', 'Harbour!2026');
    expect(good.status).toBe(200);
    expect(good.body.data.accessToken).toBeTruthy();
    expect(good.body.data.user.role.name).toBe('Manager');
    expect(cookieFrom(good)).toContain('ag_refresh=');
  });

  it('rotates refresh tokens and revokes the family if an old token is reused', async () => {
    const first = await login('leela.dsouza@aquageno.local', 'Harbour!2026');
    const original = cookieFrom(first);
    const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', original);
    expect(rotated.status).toBe(200);
    const next = cookieFrom(rotated);
    expect(next).toBeTruthy();
    expect(next).not.toBe(original);

    const reuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', original);
    expect(reuse.status).toBe(401);

    const revoked = await request(app).post('/api/v1/auth/refresh').set('Cookie', next);
    expect(revoked.status).toBe(401);
  });

  it('blocks the admin until the temporary password is changed', async () => {
    const signed = await login('admin@aquageno.local', 'ChangeMe!2026');
    expect(signed.status).toBe(200);
    expect(signed.body.data.user.mustChangePassword).toBe(true);
    const token = signed.body.data.accessToken as string;
    const blocked = await request(app).get('/api/v1/items').set(auth(token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await request(app)
      .post('/api/v1/auth/change-password')
      .set(auth(token))
      .send({ currentPassword: 'ChangeMe!2026', newPassword: 'PlantBook!2026' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.user.mustChangePassword).toBe(false);
    const items = await request(app).get('/api/v1/items').set(auth(changed.body.data.accessToken));
    expect(items.status).toBe(200);
  });

  it('issues a reset link through the mailer and accepts the new password', async () => {
    mailer.outbox.length = 0;
    const missing = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@aquageno.local' });
    expect(missing.status).toBe(200);
    expect(mailer.outbox).toHaveLength(0);

    const sent = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'leela.dsouza@aquageno.local' });
    expect(sent.status).toBe(200);
    expect(mailer.outbox).toHaveLength(1);
    const token = /token=([^&\s]+)/.exec(mailer.outbox[0].text)?.[1];
    expect(token).toBeTruthy();
    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: decodeURIComponent(token!), newPassword: 'ViewerBook!2026' });
    expect(reset.status).toBe(200);
    const again = await login('leela.dsouza@aquageno.local', 'ViewerBook!2026');
    expect(again.status).toBe(200);
  });
});
