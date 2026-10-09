import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { prisma } from '../../lib/prisma';
import { auth, login, resetAndSeed, disconnect } from '../helpers';

let token = '';
let warehouseId = '';
let supplierId = '';
let customerId = '';
let itemId = '';

beforeAll(async () => {
  await resetAndSeed();
  const signed = await login('meera.nair@aquageno.local', 'Harbour!2026');
  token = signed.body.data.accessToken;
  const reference = await request(app).get('/api/v1/reference').set(auth(token));
  warehouseId = reference.body.data.warehouses.find((row: { code: string }) => row.code === 'WH-KOCHI').id;
  supplierId = reference.body.data.suppliers[0].id;
  customerId = reference.body.data.customers[0].id;
  const categoryId = reference.body.data.categories[0].id;
  const unitId = reference.body.data.units.find((row: { code: string }) => row.code === 'KG').id;
  const created = await request(app).post('/api/v1/items').set(auth(token)).send({
    sku: 'RM-TEST-LOT',
    name: 'Test lot squid',
    itemType: 'RAW_MATERIAL',
    categoryId,
    unitId,
    reorderLevel: '0.000',
    standardCost: '100.00',
    isActive: true,
  });
  expect(created.status).toBe(201);
  itemId = created.body.data.id;
});

afterAll(async () => {
  await disconnect();
});

async function postPurchase(lines: Array<{ itemId: string; quantity: string; unitPrice: string }>) {
  const draft = await request(app).post('/api/v1/purchases').set(auth(token)).send({
    supplierId,
    invoiceNo: `T-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    invoiceDate: '2026-09-27',
    warehouseId,
    notes: 'Test receipt',
    lines,
  });
  expect(draft.status).toBe(201);
  const submitted = await request(app).post(`/api/v1/purchases/${draft.body.data.id}/submit`).set(auth(token));
  expect(submitted.status).toBe(200);
  const approved = await request(app)
    .post(`/api/v1/purchases/${draft.body.data.id}/approve`)
    .set(auth(token))
    .send({ remarks: 'Checked' });
  return { draft, approved };
}

describe('stock posting', () => {
  it('stores multi-line totals on the draft before anything hits stock', async () => {
    const draft = await request(app).post('/api/v1/purchases').set(auth(token)).send({
      supplierId,
      invoiceNo: `TOT-${Date.now()}`,
      invoiceDate: '2026-09-27',
      warehouseId,
      notes: '',
      lines: [
        { itemId, quantity: '0.335', unitPrice: '1.00' },
        { itemId, quantity: '0.335', unitPrice: '1.00' },
      ],
    });
    expect(draft.status).toBe(201);
    expect(draft.body.data.totalAmount).toBe('0.68');
    expect(draft.body.data.lines).toHaveLength(2);
    expect(draft.body.data.lines[0].lineTotal).toBe('0.34');
  });

  it('refuses to post a shipment that would take stock negative and leaves the balance unchanged', async () => {
    const purchase = await postPurchase([{ itemId, quantity: '10.000', unitPrice: '100.00' }]);
    expect(purchase.approved.status).toBe(200);

    const tooMuch = await request(app).post('/api/v1/shipments').set(auth(token)).send({
      customerId,
      shipmentDate: '2026-09-27',
      warehouseId,
      vehicleNo: 'TEST-1',
      notes: '',
      lines: [{ itemId, quantity: '10.500', unitPrice: '120.00' }],
    });
    expect(tooMuch.status).toBe(201);
    await request(app).post(`/api/v1/shipments/${tooMuch.body.data.id}/submit`).set(auth(token));
    const rejected = await request(app)
      .post(`/api/v1/shipments/${tooMuch.body.data.id}/approve`)
      .set(auth(token))
      .send({ remarks: 'Try' });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('INSUFFICIENT_STOCK');

    const balance = await prisma.stockBalance.findUnique({
      where: { itemId_warehouseId: { itemId, warehouseId } },
    });
    expect(balance?.quantity.toString()).toBe('10');

    const stillPending = await request(app).get(`/api/v1/shipments/${tooMuch.body.data.id}`).set(auth(token));
    expect(stillPending.body.data.status).toBe('PENDING_APPROVAL');

    const okDraft = await request(app).post('/api/v1/shipments').set(auth(token)).send({
      customerId,
      shipmentDate: '2026-09-27',
      warehouseId,
      vehicleNo: 'TEST-2',
      notes: '',
      lines: [{ itemId, quantity: '4.000', unitPrice: '120.00' }],
    });
    await request(app).post(`/api/v1/shipments/${okDraft.body.data.id}/submit`).set(auth(token));
    const posted = await request(app)
      .post(`/api/v1/shipments/${okDraft.body.data.id}/approve`)
      .set(auth(token))
      .send({ remarks: 'Dispatch' });
    expect(posted.status).toBe(200);
    const after = await prisma.stockBalance.findUnique({
      where: { itemId_warehouseId: { itemId, warehouseId } },
    });
    expect(after?.quantity.toString()).toBe('6');
  });
});
