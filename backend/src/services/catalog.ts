import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { writeAudit } from '../lib/audit';
import { conflict, notFound, validation } from '../lib/errors';
import type { AuthUser } from '../types';
import type { z } from 'zod';
import {
  bomSchema,
  categorySchema,
  itemSchema,
  packingConfigSchema,
  partySchema,
  unitSchema,
  warehouseSchema,
} from '../lib/validators';

type Tx = Prisma.TransactionClient;

const alive = { deletedAt: null };

function stateWhere(state: 'active' | 'inactive' | 'all') {
  if (state === 'active') return { ...alive, isActive: true };
  if (state === 'inactive') return { ...alive, isActive: false };
  return alive;
}

async function retire(
  user: AuthUser,
  entityType: string,
  label: string,
  id: string,
  references: () => Promise<number>,
  deactivate: (tx: Tx) => Promise<unknown>,
  remove: (tx: Tx) => Promise<unknown>,
) {
  const count = await references();
  const mode = count > 0 ? 'deactivated' : 'deleted';
  await prisma.$transaction(async (tx) => {
    if (mode === 'deactivated') await deactivate(tx);
    else await remove(tx);
    await writeAudit(tx, {
      userId: user.id,
      action: mode === 'deleted' ? 'DELETE' : 'UPDATE',
      entityType,
      entityId: id,
      summary: mode === 'deleted' ? `Removed ${label}` : `Deactivated ${label} because it is used on transactions`,
      after: { mode },
    });
  });
  return { id, mode };
}

export async function listUnits(query: { page: number; pageSize: number; search?: string; state: 'active' | 'inactive' | 'all' }) {
  const where: Prisma.UnitOfMeasureWhereInput = {
    ...stateWhere(query.state),
    ...(query.search
      ? { OR: [{ code: { contains: query.search, mode: 'insensitive' } }, { name: { contains: query.search, mode: 'insensitive' } }] }
      : {}),
  };
  const [total, data] = await prisma.$transaction([
    prisma.unitOfMeasure.count({ where }),
    prisma.unitOfMeasure.findMany({
      where,
      orderBy: { code: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { data, total };
}

export async function createUnit(input: z.infer<typeof unitSchema>, user: AuthUser) {
  const row = await prisma.unitOfMeasure.create({ data: input });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'CREATE',
    entityType: 'UNIT',
    entityId: row.id,
    summary: `Added unit ${row.code}`,
    after: row,
  });
  return row;
}

export async function updateUnit(id: string, input: z.infer<typeof unitSchema>, user: AuthUser) {
  const existing = await prisma.unitOfMeasure.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('Unit');
  const row = await prisma.unitOfMeasure.update({ where: { id }, data: input });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'UPDATE',
    entityType: 'UNIT',
    entityId: id,
    summary: `Updated unit ${row.code}`,
    before: existing,
    after: row,
  });
  return row;
}

export async function deleteUnit(id: string, user: AuthUser) {
  const existing = await prisma.unitOfMeasure.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('Unit');
  return retire(
    user,
    'UNIT',
    existing.code,
    id,
    () => prisma.item.count({ where: { unitId: id, ...alive } }),
    (tx) => tx.unitOfMeasure.update({ where: { id }, data: { isActive: false } }),
    (tx) => tx.unitOfMeasure.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } }),
  );
}

export async function listCategories(query: { page: number; pageSize: number; search?: string; state: 'active' | 'inactive' | 'all' }) {
  const where: Prisma.ItemCategoryWhereInput = {
    ...stateWhere(query.state),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  };
  const [total, data] = await prisma.$transaction([
    prisma.itemCategory.count({ where }),
    prisma.itemCategory.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { data, total };
}

export async function createCategory(input: z.infer<typeof categorySchema>, user: AuthUser) {
  const row = await prisma.itemCategory.create({ data: input });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'CREATE',
    entityType: 'CATEGORY',
    entityId: row.id,
    summary: `Added category ${row.name}`,
    after: row,
  });
  return row;
}

export async function updateCategory(id: string, input: z.infer<typeof categorySchema>, user: AuthUser) {
  const existing = await prisma.itemCategory.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('Category');
  const row = await prisma.itemCategory.update({ where: { id }, data: input });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'UPDATE',
    entityType: 'CATEGORY',
    entityId: id,
    summary: `Updated category ${row.name}`,
    before: existing,
    after: row,
  });
  return row;
}

export async function deleteCategory(id: string, user: AuthUser) {
  const existing = await prisma.itemCategory.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('Category');
  return retire(
    user,
    'CATEGORY',
    existing.name,
    id,
    () => prisma.item.count({ where: { categoryId: id, ...alive } }),
    (tx) => tx.itemCategory.update({ where: { id }, data: { isActive: false } }),
    (tx) => tx.itemCategory.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } }),
  );
}

export async function listWarehouses(query: { page: number; pageSize: number; search?: string; state: 'active' | 'inactive' | 'all' }) {
  const where: Prisma.WarehouseWhereInput = {
    ...stateWhere(query.state),
    ...(query.search
      ? { OR: [{ code: { contains: query.search, mode: 'insensitive' } }, { name: { contains: query.search, mode: 'insensitive' } }] }
      : {}),
  };
  const [total, data] = await prisma.$transaction([
    prisma.warehouse.count({ where }),
    prisma.warehouse.findMany({
      where,
      orderBy: { code: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { data, total };
}

export async function createWarehouse(input: z.infer<typeof warehouseSchema>, user: AuthUser) {
  const row = await prisma.warehouse.create({ data: input });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'CREATE',
    entityType: 'WAREHOUSE',
    entityId: row.id,
    summary: `Added warehouse ${row.code}`,
    after: row,
  });
  return row;
}

export async function updateWarehouse(id: string, input: z.infer<typeof warehouseSchema>, user: AuthUser) {
  const existing = await prisma.warehouse.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('Warehouse');
  const row = await prisma.warehouse.update({ where: { id }, data: input });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'UPDATE',
    entityType: 'WAREHOUSE',
    entityId: id,
    summary: `Updated warehouse ${row.code}`,
    before: existing,
    after: row,
  });
  return row;
}

async function warehouseUsage(id: string) {
  const [purchases, productions, transfers, shipments, adjustments, ledger] = await prisma.$transaction([
    prisma.purchase.count({ where: { warehouseId: id } }),
    prisma.production.count({ where: { warehouseId: id } }),
    prisma.transfer.count({ where: { OR: [{ sourceWarehouseId: id }, { destinationWarehouseId: id }] } }),
    prisma.shipment.count({ where: { warehouseId: id } }),
    prisma.stockAdjustment.count({ where: { warehouseId: id } }),
    prisma.stockLedger.count({ where: { warehouseId: id } }),
  ]);
  return purchases + productions + transfers + shipments + adjustments + ledger;
}

export async function deleteWarehouse(id: string, user: AuthUser) {
  const existing = await prisma.warehouse.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('Warehouse');
  return retire(
    user,
    'WAREHOUSE',
    existing.code,
    id,
    () => warehouseUsage(id),
    (tx) => tx.warehouse.update({ where: { id }, data: { isActive: false } }),
    (tx) => tx.warehouse.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } }),
  );
}

const partySearch = (search?: string) =>
  search
    ? {
        OR: [
          { code: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {};

export async function listSuppliers(query: { page: number; pageSize: number; search?: string; state: 'active' | 'inactive' | 'all' }) {
  const where: Prisma.SupplierWhereInput = { ...stateWhere(query.state), ...partySearch(query.search) };
  const [total, data] = await prisma.$transaction([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { data, total };
}

export async function createSupplier(input: z.infer<typeof partySchema>, user: AuthUser) {
  const row = await prisma.supplier.create({ data: { ...input, gstin: input.gstin.toUpperCase() } });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'CREATE',
    entityType: 'SUPPLIER',
    entityId: row.id,
    summary: `Added supplier ${row.name}`,
    after: row,
  });
  return row;
}

export async function updateSupplier(id: string, input: z.infer<typeof partySchema>, user: AuthUser) {
  const existing = await prisma.supplier.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('Supplier');
  const row = await prisma.supplier.update({ where: { id }, data: { ...input, gstin: input.gstin.toUpperCase() } });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'UPDATE',
    entityType: 'SUPPLIER',
    entityId: id,
    summary: `Updated supplier ${row.name}`,
    before: existing,
    after: row,
  });
  return row;
}

export async function deleteSupplier(id: string, user: AuthUser) {
  const existing = await prisma.supplier.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('Supplier');
  return retire(
    user,
    'SUPPLIER',
    existing.name,
    id,
    () => prisma.purchase.count({ where: { supplierId: id } }),
    (tx) => tx.supplier.update({ where: { id }, data: { isActive: false } }),
    (tx) => tx.supplier.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } }),
  );
}

export async function listCustomers(query: { page: number; pageSize: number; search?: string; state: 'active' | 'inactive' | 'all' }) {
  const where: Prisma.CustomerWhereInput = { ...stateWhere(query.state), ...partySearch(query.search) };
  const [total, data] = await prisma.$transaction([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { data, total };
}

export async function createCustomer(input: z.infer<typeof partySchema>, user: AuthUser) {
  const row = await prisma.customer.create({ data: { ...input, gstin: input.gstin.toUpperCase() } });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'CREATE',
    entityType: 'CUSTOMER',
    entityId: row.id,
    summary: `Added customer ${row.name}`,
    after: row,
  });
  return row;
}

export async function updateCustomer(id: string, input: z.infer<typeof partySchema>, user: AuthUser) {
  const existing = await prisma.customer.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('Customer');
  const row = await prisma.customer.update({ where: { id }, data: { ...input, gstin: input.gstin.toUpperCase() } });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'UPDATE',
    entityType: 'CUSTOMER',
    entityId: id,
    summary: `Updated customer ${row.name}`,
    before: existing,
    after: row,
  });
  return row;
}

export async function deleteCustomer(id: string, user: AuthUser) {
  const existing = await prisma.customer.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('Customer');
  return retire(
    user,
    'CUSTOMER',
    existing.name,
    id,
    () => prisma.shipment.count({ where: { customerId: id } }),
    (tx) => tx.customer.update({ where: { id }, data: { isActive: false } }),
    (tx) => tx.customer.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } }),
  );
}

const itemInclude = { category: true, unit: true } satisfies Prisma.ItemInclude;

export async function listItems(query: {
  page: number;
  pageSize: number;
  search?: string;
  state: 'active' | 'inactive' | 'all';
  itemType?: 'RAW_MATERIAL' | 'PACKING_MATERIAL' | 'FINISHED_GOOD';
}) {
  const where: Prisma.ItemWhereInput = {
    ...stateWhere(query.state),
    ...(query.itemType ? { itemType: query.itemType } : {}),
    ...(query.search
      ? { OR: [{ sku: { contains: query.search, mode: 'insensitive' } }, { name: { contains: query.search, mode: 'insensitive' } }] }
      : {}),
  };
  const [total, data] = await prisma.$transaction([
    prisma.item.count({ where }),
    prisma.item.findMany({
      where,
      include: itemInclude,
      orderBy: { sku: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { data, total };
}

export async function getItem(id: string) {
  const row = await prisma.item.findFirst({ where: { id, ...alive }, include: itemInclude });
  if (!row) throw notFound('Item');
  return row;
}

async function assertItemRefs(input: z.infer<typeof itemSchema>) {
  const [category, unit] = await Promise.all([
    prisma.itemCategory.findFirst({ where: { id: input.categoryId, ...alive, isActive: true } }),
    prisma.unitOfMeasure.findFirst({ where: { id: input.unitId, ...alive, isActive: true } }),
  ]);
  if (!category) throw validation('Choose an active item category.');
  if (!unit) throw validation('Choose an active unit of measure.');
}

export async function createItem(input: z.infer<typeof itemSchema>, user: AuthUser) {
  await assertItemRefs(input);
  const row = await prisma.item.create({ data: input, include: itemInclude });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'CREATE',
    entityType: 'ITEM',
    entityId: row.id,
    summary: `Added item ${row.sku}`,
    after: { sku: row.sku, name: row.name, itemType: row.itemType, reorderLevel: row.reorderLevel.toString(), standardCost: row.standardCost.toString() },
  });
  return row;
}

export async function updateItem(id: string, input: z.infer<typeof itemSchema>, user: AuthUser) {
  const existing = await prisma.item.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('Item');
  await assertItemRefs(input);
  const row = await prisma.item.update({ where: { id }, data: input, include: itemInclude });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'UPDATE',
    entityType: 'ITEM',
    entityId: id,
    summary: `Updated item ${row.sku}`,
    before: { sku: existing.sku, name: existing.name, itemType: existing.itemType, reorderLevel: existing.reorderLevel.toString(), standardCost: existing.standardCost.toString(), isActive: existing.isActive },
    after: { sku: row.sku, name: row.name, itemType: row.itemType, reorderLevel: row.reorderLevel.toString(), standardCost: row.standardCost.toString(), isActive: row.isActive },
  });
  return row;
}

async function itemUsage(id: string) {
  const [p, pr, pl, t, s, a, b, bl, ledger] = await prisma.$transaction([
    prisma.purchaseLine.count({ where: { itemId: id } }),
    prisma.production.count({ where: { finishedItemId: id } }),
    prisma.productionLine.count({ where: { itemId: id } }),
    prisma.transferLine.count({ where: { itemId: id } }),
    prisma.shipmentLine.count({ where: { itemId: id } }),
    prisma.adjustmentLine.count({ where: { itemId: id } }),
    prisma.bom.count({ where: { finishedItemId: id } }),
    prisma.bomLine.count({ where: { itemId: id } }),
    prisma.stockLedger.count({ where: { itemId: id } }),
  ]);
  return p + pr + pl + t + s + a + b + bl + ledger;
}

export async function deleteItem(id: string, user: AuthUser) {
  const existing = await prisma.item.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('Item');
  return retire(
    user,
    'ITEM',
    existing.sku,
    id,
    () => itemUsage(id),
    (tx) => tx.item.update({ where: { id }, data: { isActive: false } }),
    (tx) => tx.item.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } }),
  );
}

const bomInclude = {
  finishedItem: { include: { unit: true } },
  lines: { include: { item: { include: { unit: true } } }, orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.BomInclude;

export async function listBoms(query: {
  page: number;
  pageSize: number;
  search?: string;
  state: 'active' | 'inactive' | 'all';
  finishedItemId?: string;
}) {
  const where: Prisma.BomWhereInput = {
    ...stateWhere(query.state),
    ...(query.finishedItemId ? { finishedItemId: query.finishedItemId } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  };
  const [total, data] = await prisma.$transaction([
    prisma.bom.count({ where }),
    prisma.bom.findMany({
      where,
      include: bomInclude,
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { data, total };
}

export async function getBom(id: string) {
  const row = await prisma.bom.findFirst({ where: { id, ...alive }, include: bomInclude });
  if (!row) throw notFound('BOM');
  return row;
}

async function assertBom(input: z.infer<typeof bomSchema>) {
  const finished = await prisma.item.findFirst({ where: { id: input.finishedItemId, ...alive, isActive: true } });
  if (!finished || finished.itemType !== 'FINISHED_GOOD') {
    throw validation('A BOM must belong to an active finished good.');
  }
  const ids = input.lines.map((line) => line.itemId);
  if (ids.includes(input.finishedItemId)) throw validation('The finished good cannot be one of its own components.');
  const items = await prisma.item.findMany({ where: { id: { in: ids }, ...alive, isActive: true } });
  if (items.length !== new Set(ids).size) throw validation('Every BOM component must be an active item.');
  if (items.some((item) => item.itemType === 'FINISHED_GOOD')) {
    throw validation('BOM components must be raw materials or packing materials.');
  }
}

export async function createBom(input: z.infer<typeof bomSchema>, user: AuthUser) {
  await assertBom(input);
  const row = await prisma.bom.create({
    data: {
      finishedItemId: input.finishedItemId,
      name: input.name,
      isActive: input.isActive,
      lines: {
        create: input.lines.map((line, index) => ({
          itemId: line.itemId,
          qtyPerUnit: line.qtyPerUnit,
          sortOrder: index,
        })),
      },
    },
    include: bomInclude,
  });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'CREATE',
    entityType: 'BOM',
    entityId: row.id,
    summary: `Added BOM ${row.name}`,
    after: { name: row.name, finishedItemId: row.finishedItemId, lines: input.lines },
  });
  return row;
}

export async function updateBom(id: string, input: z.infer<typeof bomSchema>, user: AuthUser) {
  const existing = await prisma.bom.findFirst({ where: { id, ...alive }, include: { lines: true } });
  if (!existing) throw notFound('BOM');
  await assertBom(input);
  const row = await prisma.$transaction(async (tx) => {
    await tx.bomLine.deleteMany({ where: { bomId: id } });
    return tx.bom.update({
      where: { id },
      data: {
        finishedItemId: input.finishedItemId,
        name: input.name,
        isActive: input.isActive,
        lines: {
          create: input.lines.map((line, index) => ({
            itemId: line.itemId,
            qtyPerUnit: line.qtyPerUnit,
            sortOrder: index,
          })),
        },
      },
      include: bomInclude,
    });
  });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'UPDATE',
    entityType: 'BOM',
    entityId: id,
    summary: `Updated BOM ${row.name}`,
    before: { name: existing.name, lines: existing.lines.map((line) => ({ itemId: line.itemId, qtyPerUnit: line.qtyPerUnit.toString() })) },
    after: { name: row.name, lines: input.lines },
  });
  return row;
}

export async function deleteBom(id: string, user: AuthUser) {
  const existing = await prisma.bom.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('BOM');
  await prisma.bom.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'DELETE',
    entityType: 'BOM',
    entityId: id,
    summary: `Removed BOM ${existing.name}`,
  });
  return { id, mode: 'deleted' as const };
}

export async function referenceData() {
  const [units, categories, warehouses, suppliers, customers, items, roles] = await Promise.all([
    prisma.unitOfMeasure.findMany({ where: { ...alive, isActive: true }, orderBy: { code: 'asc' } }),
    prisma.itemCategory.findMany({ where: { ...alive, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.warehouse.findMany({ where: { ...alive, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.supplier.findMany({ where: { ...alive, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.customer.findMany({ where: { ...alive, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.item.findMany({
      where: { ...alive, isActive: true },
      include: { unit: true, category: true },
      orderBy: { sku: 'asc' },
    }),
    prisma.role.findMany({
      where: { ...alive, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return { units, categories, warehouses, suppliers, customers, items, roles };
}

export async function assertNoDuplicateCode(message: string): Promise<never> {
  throw conflict(message);
}

const packingInclude = {
  finishedItem: { include: { unit: true, category: true } },
} satisfies Prisma.PackingConfigurationInclude;

export async function listPackingConfigs(query: {
  page: number;
  pageSize: number;
  search?: string;
  state: 'active' | 'inactive' | 'all';
}) {
  const where: Prisma.PackingConfigurationWhereInput = {
    ...stateWhere(query.state),
    ...(query.search
      ? {
          OR: [
            { grade: { contains: query.search, mode: 'insensitive' } },
            { finishedItem: { sku: { contains: query.search, mode: 'insensitive' } } },
            { finishedItem: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [total, data] = await prisma.$transaction([
    prisma.packingConfiguration.count({ where }),
    prisma.packingConfiguration.findMany({
      where,
      include: packingInclude,
      orderBy: { finishedItem: { sku: 'asc' } },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { data, total };
}

export async function getPackingConfig(id: string) {
  const row = await prisma.packingConfiguration.findFirst({ where: { id }, include: packingInclude });
  if (!row) throw notFound('Packing configuration');
  return row;
}

export async function getPackingConfigByItemId(itemId: string) {
  return prisma.packingConfiguration.findFirst({
    where: { finishedItemId: itemId, isActive: true },
  });
}

async function assertPackingItem(finishedItemId: string) {
  const item = await prisma.item.findFirst({ where: { id: finishedItemId, deletedAt: null } });
  if (!item || !item.isActive) throw validation('Choose an active item.');
  if (item.itemType !== 'FINISHED_GOOD') throw validation('A packing configuration needs a finished good.');
  return item;
}

export async function createPackingConfig(input: z.infer<typeof packingConfigSchema>, user: AuthUser) {
  const item = await assertPackingItem(input.finishedItemId);
  const existing = await prisma.packingConfiguration.findUnique({
    where: { finishedItemId: input.finishedItemId },
  });
  if (existing) throw conflict(`${item.sku} already has a packing configuration.`);
  const row = await prisma.packingConfiguration.create({
    data: {
      finishedItemId: input.finishedItemId,
      grade: input.grade,
      slabWeightKg: input.slabWeightKg,
      slabsPerCase: input.slabsPerCase,
      tareWeightKg: input.tareWeightKg ?? '0.000',
      isActive: input.isActive ?? true,
    },
    include: packingInclude,
  });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'CREATE',
    entityType: 'PACKING_CONFIG',
    entityId: row.id,
    summary: `Added packing configuration for ${item.sku} (${input.grade}, ${input.slabsPerCase} slabs/case)`,
    after: { sku: item.sku, grade: input.grade },
  });
  return row;
}

export async function updatePackingConfig(id: string, input: z.infer<typeof packingConfigSchema>, user: AuthUser) {
  const existing = await prisma.packingConfiguration.findFirst({ where: { id } });
  if (!existing) throw notFound('Packing configuration');
  const item = await assertPackingItem(input.finishedItemId);
  if (input.finishedItemId !== existing.finishedItemId) {
    const clash = await prisma.packingConfiguration.findUnique({
      where: { finishedItemId: input.finishedItemId },
    });
    if (clash) throw conflict(`${item.sku} already has a packing configuration.`);
  }
  const row = await prisma.packingConfiguration.update({
    where: { id },
    data: {
      finishedItemId: input.finishedItemId,
      grade: input.grade,
      slabWeightKg: input.slabWeightKg,
      slabsPerCase: input.slabsPerCase,
      tareWeightKg: input.tareWeightKg ?? '0.000',
      isActive: input.isActive ?? true,
    },
    include: packingInclude,
  });
  await writeAudit(prisma, {
    userId: user.id,
    action: 'UPDATE',
    entityType: 'PACKING_CONFIG',
    entityId: id,
    summary: `Updated packing configuration for ${item.sku}`,
    before: { grade: existing.grade, slabsPerCase: existing.slabsPerCase },
    after: { grade: row.grade, slabsPerCase: row.slabsPerCase },
  });
  return row;
}

async function packingConfigUsage(id: string) {
  const config = await prisma.packingConfiguration.findUniqueOrThrow({ where: { id } });
  const [productions, transfers, shipments] = await prisma.$transaction([
    prisma.production.count({ where: { finishedItemId: config.finishedItemId } }),
    prisma.transferLine.count({ where: { itemId: config.finishedItemId, cases: { not: null } } }),
    prisma.shipmentLine.count({ where: { itemId: config.finishedItemId, cases: { not: null } } }),
  ]);
  return productions + transfers + shipments;
}

export async function deletePackingConfig(id: string, user: AuthUser) {
  const existing = await prisma.packingConfiguration.findFirst({ where: { id }, include: packingInclude });
  if (!existing) throw notFound('Packing configuration');
  return retire(
    user,
    'PACKING_CONFIG',
    existing.finishedItem.sku,
    id,
    () => packingConfigUsage(id),
    (tx) => tx.packingConfiguration.update({ where: { id }, data: { isActive: false } }),
    (tx) => tx.packingConfiguration.delete({ where: { id } }),
  );
}
