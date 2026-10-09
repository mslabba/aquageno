import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { auth, login, resetAndSeed, disconnect } from '../helpers';

beforeAll(async () => {
  await resetAndSeed();
});

afterAll(async () => {
  await disconnect();
});

describe('permission middleware', () => {
  it('lets a viewer read purchases and blocks creating one', async () => {
    const viewer = await login('leela.dsouza@aquageno.local', 'Harbour!2026');
    const token = viewer.body.data.accessToken as string;
    const list = await request(app).get('/api/v1/purchases').set(auth(token));
    expect(list.status).toBe(200);
    const created = await request(app).post('/api/v1/purchases').set(auth(token)).send({
      supplierId: 'x',
      invoiceNo: 'NOPE',
      invoiceDate: '2026-09-27',
      warehouseId: 'x',
      lines: [{ itemId: 'x', quantity: '1', unitPrice: '1' }],
    });
    expect(created.status).toBe(403);
    expect(created.body.error.code).toBe('FORBIDDEN');
  });

  it('applies a role change on the next request without a new login', async () => {
    const adminLogin = await login('admin@aquageno.local', 'ChangeMe!2026');
    const changed = await request(app)
      .post('/api/v1/auth/change-password')
      .set(auth(adminLogin.body.data.accessToken))
      .send({ currentPassword: 'ChangeMe!2026', newPassword: 'PlantBook!2026' });
    const adminToken = changed.body.data.accessToken as string;

    const managerLogin = await login('meera.nair@aquageno.local', 'Harbour!2026');
    const managerToken = managerLogin.body.data.accessToken as string;
    const roles = await request(app).get('/api/v1/roles').set(auth(adminToken));
    const manager = roles.body.data.find((role: { name: string }) => role.name === 'Manager');
    const stripped = structuredClone(manager.grants);
    stripped.PURCHASES = ['VIEW'];
    const saved = await request(app)
      .put(`/api/v1/roles/${manager.id}/permissions`)
      .set(auth(adminToken))
      .send({ grants: stripped });
    expect(saved.status).toBe(200);

    const blocked = await request(app).post('/api/v1/purchases').set(auth(managerToken)).send({
      supplierId: 'x',
      invoiceNo: 'NOPE',
      invoiceDate: '2026-09-27',
      warehouseId: 'x',
      lines: [{ itemId: 'x', quantity: '1', unitPrice: '1' }],
    });
    expect(blocked.status).toBe(403);

    const restored = await request(app)
      .put(`/api/v1/roles/${manager.id}/permissions`)
      .set(auth(adminToken))
      .send({ grants: manager.grants });
    expect(restored.status).toBe(200);
    const allowed = await request(app).get('/api/v1/purchases').set(auth(managerToken));
    expect(allowed.status).toBe(200);
  });
});
