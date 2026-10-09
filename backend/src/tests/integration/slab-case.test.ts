import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { prisma } from '../../lib/prisma';
import { auth, login, resetAndSeed, disconnect } from '../helpers';

let token = '';
let warehouseId = '';
let supplierId = '';
let customerId = '';
let categoryId = '';
let slabUnitId = '';
let finishedItemId = '';

async function approve(kind: string, id: string) {
  const submitted = await request(app).post(`/api/v1/${kind}/${id}/submit`).set(auth(token));
  expect(submitted.status).toBe(200);
  const approved = await request(app).post(`/api/v1/${kind}/${id}/approve`).set(auth(token)).send({ remarks: 'ok' });
  expect(approved.status).toBe(200);
  return approved.body.data;
}

beforeAll(async () => {
  await resetAndSeed();
  const signed = await login('meera.nair@aquageno.local', 'Harbour!2026');
  token = signed.body.data.token;
  const reference = await request(app).get('/api/v1/reference').set(auth(token));
  warehouseId = reference.body.data.warehouses.find((row: { code: string }) => row.code === 'WH-KOCHI').id;
  supplierId = reference.body.data.suppliers[0].id;
  customerId = reference.body.data.customers[0].id;
  categoryId = reference.body.data.categories[0].id;
  slabUnitId = reference.body.data.units.find((row: { code: string }) => row.code === 'SLB').id;
  expect(slabUnitId).toBeTruthy();

  const item = await request(app).post('/api/v1/items').set(auth(token)).send({
    sku: 'FG-TEST-6X16',
    name: 'Test squid 6x1.6kg',
    itemType: 'FINISHED_GOOD',
    categoryId,
    unitId: slabUnitId,
    reorderLevel: '0.000',
    standardCost: '400.00',
    isActive: true,
  });
  expect(item.status).toBe(201);
  finishedItemId = item.body.data.id;

  const config = await request(app).post('/api/v1/packing-configs').set(auth(token)).send({
    finishedItemId,
    grade: '6/10',
    slabWeightKg: '1.600',
    slabsPerCase: 6,
    tareWeightKg: '0.700',
  });
  expect(config.status).toBe(201);
});

afterAll(async () => {
  await disconnect();
});

describe('slab/case production', () => {
  it('splits 415 slabs into 69 cases + 1 loose slab with net weight', async () => {
    const raw = await request(app).post('/api/v1/items').set(auth(token)).send({
      sku: 'RM-TEST-SLAB2',
      name: 'Test raw squid',
      itemType: 'RAW_MATERIAL',
      categoryId,
      unitId: slabUnitId,
      reorderLevel: '0.000',
      standardCost: '250.00',
      isActive: true,
    });
    const rawId = raw.body.data.id;
    const purchase = await request(app).post('/api/v1/purchases').set(auth(token)).send({
      supplierId,
      invoiceNo: `SLAB-${Date.now()}`,
      invoiceDate: '2026-09-28',
      warehouseId,
      notes: '',
      lines: [{ itemId: rawId, quantity: '800.000', unitPrice: '250.00' }],
    });
    expect(purchase.status).toBe(201);
    await approve('purchases', purchase.body.data.id);

    const draft = await request(app).post('/api/v1/productions').set(auth(token)).send({
      finishedItemId,
      quantity: '415.000',
      batchNo: 'TEST-SLAB-1',
      producedOn: '2026-09-28',
      warehouseId,
      notes: '',
      lines: [{ itemId: rawId, quantity: '760.000' }],
      sourcePurchaseIds: [purchase.body.data.id],
    });
    expect(draft.status).toBe(201);
    expect(draft.body.data.slabsProduced).toBe('415.000');
    expect(draft.body.data.casesProduced).toBe(69);
    expect(draft.body.data.looseSlabs).toBe('1.000');
    expect(draft.body.data.netWeightKg).toBe('664.000');
    expect(draft.body.data.sources).toHaveLength(1);

    const posted = await approve('productions', draft.body.data.id);
    expect(posted.slabsProduced).toBe('415.000');

    const balances = await request(app)
      .get(`/api/v1/stock/balances?itemId=${finishedItemId}&warehouseId=${warehouseId}`)
      .set(auth(token));
    expect(balances.status).toBe(200);
    const row = balances.body.data[0];
    expect(row.packing.cases).toBe(69);
    expect(row.packing.looseSlabs).toBe('1.000');
    expect(row.packing.totalSlabs).toBe('415.000');
    expect(row.packing.netWeightKg).toBe('664.000');
  });

  it('rejects a second packing config for the same item', async () => {
    const dup = await request(app).post('/api/v1/packing-configs').set(auth(token)).send({
      finishedItemId,
      grade: '10/20',
      slabWeightKg: '1.600',
      slabsPerCase: 6,
    });
    expect(dup.status).toBe(409);
  });

  it('rejects a packing config for a raw material', async () => {
    const raw = await request(app).post('/api/v1/items').set(auth(token)).send({
      sku: 'RM-TEST-SLAB',
      name: 'Test raw',
      itemType: 'RAW_MATERIAL',
      categoryId,
      unitId: slabUnitId,
      reorderLevel: '0.000',
      standardCost: '10.00',
      isActive: true,
    });
    const bad = await request(app).post('/api/v1/packing-configs').set(auth(token)).send({
      finishedItemId: raw.body.data.id,
      grade: 'X',
      slabWeightKg: '1.000',
      slabsPerCase: 4,
    });
    expect(bad.status).toBe(422);
  });
});

describe('slab/case transfer and shipment', () => {
  it('rejects case entry for an item without a packing config', async () => {
    const other = await request(app).get('/api/v1/reference').set(auth(token));
    const plainId = other.body.data.items.find((row: { itemType: string }) => row.itemType === 'RAW_MATERIAL').id;
    const wh2 = other.body.data.warehouses.find((row: { code: string }) => row.code === 'WH-MUMBAI').id;
    const draft = await request(app).post('/api/v1/transfers').set(auth(token)).send({
      sourceWarehouseId: warehouseId,
      destinationWarehouseId: wh2,
      transferDate: '2026-09-28',
      notes: '',
      lines: [{ itemId: plainId, cases: '5', looseSlabs: '0.000' }],
    });
    expect(draft.status).toBe(422);
  });
});

describe('trace endpoint', () => {
  it('requires one of the ids', async () => {
    const res = await request(app).get('/api/v1/trace').set(auth(token));
    expect(res.status).toBe(422);
  });

  it('returns 404 for an unknown purchase', async () => {
    const res = await request(app).get('/api/v1/trace?purchaseId=does-not-exist').set(auth(token));
    expect(res.status).toBe(404);
  });
});
