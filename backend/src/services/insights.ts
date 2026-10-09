import { DocStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { businessToday, formatDate, parseDate } from '../lib/dates';
import { d, money, qty } from '../lib/money';
import { grossWeightKg, netWeightKg, splitSlabs } from '../lib/packing';
import type { z } from 'zod';
import { reportQuerySchema, stockQuerySchema } from '../lib/validators';

type ReportQuery = z.infer<typeof reportQuerySchema>;
type StockQuery = z.infer<typeof stockQuerySchema>;

const POSTED: DocStatus[] = ['POSTED', 'REVERSED'];

export type Column = { key: string; label: string; type?: 'text' | 'qty' | 'money' };
export type Tabular = {
  title: string;
  kpis: Array<{ label: string; value: string }>;
  columns: Column[];
  rows: Array<Record<string, string>>;
  total: number;
  truncated?: boolean;
};

function slicePage<T>(rows: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

function inRange(field: { gte?: Date; lte?: Date }, from?: string, to?: string) {
  if (from) field.gte = parseDate(from);
  if (to) field.lte = parseDate(to);
  return field;
}

export async function dashboard() {
  const balances = await prisma.stockBalance.findMany({ include: { item: true, warehouse: true } });
  let stockValue = d(0);
  for (const balance of balances) {
    stockValue = stockValue.plus(d(balance.quantity).mul(d(balance.item.standardCost)));
  }
  const today = parseDate(businessToday());
  const [movementsToday, pendingApprovals, items, warehouses, productions, shipments] = await Promise.all([
    prisma.stockLedger.count({ where: { movementDate: today } }),
    prisma.approvalTask.count({ where: { status: 'PENDING' } }),
    prisma.item.findMany({
      where: { deletedAt: null, isActive: true, reorderLevel: { gt: 0 } },
      include: { unit: true, balances: true, category: true },
      orderBy: { sku: 'asc' },
    }),
    prisma.warehouse.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { code: 'asc' } }),
    prisma.production.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { docNo: true, status: true },
    }),
    prisma.shipment.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { docNo: true, status: true },
    }),
  ]);
  const low = items
    .map((item) => {
      const onHand = item.balances.reduce((sum, row) => sum.plus(d(row.quantity)), d(0));
      return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        unit: item.unit.code,
        onHand: qty(onHand),
        reorderLevel: qty(item.reorderLevel),
        shortfall: qty(d(item.reorderLevel).minus(onHand)),
        below: onHand.lessThanOrEqualTo(item.reorderLevel),
      };
    })
    .filter((item) => item.below);
  const activityRows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12 });
  const userIds = [...new Set(activityRows.map((row) => row.userId).filter((id): id is string => Boolean(id)))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const names = new Map(users.map((user) => [user.id, user.name]));
  const byWarehouse = warehouses.map((warehouse) => {
    const rows = balances.filter((row) => row.warehouseId === warehouse.id);
    const valueOf = (type: 'FINISHED_GOOD' | 'RAW_MATERIAL') =>
      rows
        .filter((row) => row.item.itemType === type)
        .reduce((sum, row) => sum.plus(d(row.quantity).mul(d(row.item.standardCost))), d(0));
    return {
      id: warehouse.id,
      name: warehouse.name,
      finishedValue: money(valueOf('FINISHED_GOOD')),
      rawValue: money(valueOf('RAW_MATERIAL')),
    };
  });
  return {
    kpis: {
      stockValue: money(stockValue),
      movementsToday,
      lowStockCount: low.length,
      pendingApprovals,
    },
    byWarehouse,
    pipeline: [
      ...productions.map((row) => ({ kind: 'production' as const, docNo: row.docNo, status: row.status })),
      ...shipments.map((row) => ({ kind: 'shipment' as const, docNo: row.docNo, status: row.status })),
    ],
    lowStock: low.slice(0, 8),
    activity: activityRows.map((row) => ({
      id: row.id,
      action: row.action,
      summary: row.summary,
      entityType: row.entityType,
      entityId: row.entityId,
      createdAt: row.createdAt,
      userName: row.userId ? names.get(row.userId) ?? 'Unknown user' : 'System',
    })),
  };
}

export async function stockBalances(query: StockQuery) {
  const rows = await prisma.stockBalance.findMany({
    where: {
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      item: {
        deletedAt: null,
        ...(query.search
          ? {
              OR: [
                { sku: { contains: query.search, mode: 'insensitive' } },
                { name: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    },
    include: { item: { include: { unit: true, category: true, packingConfig: true } }, warehouse: true },
    orderBy: [{ item: { sku: 'asc' } }, { warehouse: { code: 'asc' } }],
  });
  const totals = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    totals.set(row.itemId, (totals.get(row.itemId) ?? d(0)).plus(d(row.quantity)));
  }
  let shaped = rows.map((row) => {
    const packing = row.item.packingConfig?.isActive ? row.item.packingConfig : null;
    let packingBreakdown: {
      grade: string;
      slabsPerCase: number;
      slabWeightKg: string;
      tareWeightKg: string;
      cases: number;
      looseSlabs: string;
      totalSlabs: string;
      netWeightKg: string;
      grossWeightKg: string;
    } | null = null;
    if (packing) {
      const split = splitSlabs(row.quantity, packing.slabsPerCase);
      const net = netWeightKg(row.quantity, packing.slabWeightKg);
      packingBreakdown = {
        grade: packing.grade,
        slabsPerCase: packing.slabsPerCase,
        slabWeightKg: qty(packing.slabWeightKg),
        tareWeightKg: qty(packing.tareWeightKg),
        cases: split.cases,
        looseSlabs: split.looseSlabs,
        totalSlabs: qty(row.quantity),
        netWeightKg: net,
        grossWeightKg: grossWeightKg(net, split.cases, packing.tareWeightKg),
      };
    }
    return {
      itemId: row.itemId,
      sku: row.item.sku,
      name: row.item.name,
      itemType: row.item.itemType,
      category: row.item.category.name,
      unit: row.item.unit.code,
      warehouseId: row.warehouseId,
      warehouse: row.warehouse.name,
      quantity: qty(row.quantity),
      reorderLevel: qty(row.item.reorderLevel),
      standardCost: money(row.item.standardCost),
      value: money(d(row.quantity).mul(d(row.item.standardCost))),
      totalOnHand: qty(totals.get(row.itemId) ?? 0),
      packing: packingBreakdown,
    };
  });
  if (query.belowReorder === 'true') {
    const watched = await prisma.item.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        reorderLevel: { gt: 0 },
        ...(query.itemId ? { id: query.itemId } : {}),
        ...(query.search
          ? {
              OR: [
                { sku: { contains: query.search, mode: 'insensitive' } },
                { name: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { balances: true, unit: true, category: true },
    });
    const lowIds = new Set(
      watched
        .filter((item) => {
          const onHand = item.balances.reduce((sum, balance) => sum.plus(d(balance.quantity)), d(0));
          return onHand.lessThanOrEqualTo(item.reorderLevel);
        })
        .map((item) => item.id),
    );
    shaped = shaped.filter((row) => lowIds.has(row.itemId));
    for (const item of watched) {
      if (!lowIds.has(item.id)) continue;
      if (shaped.some((row) => row.itemId === item.id)) continue;
      const onHand = item.balances.reduce((sum, balance) => sum.plus(d(balance.quantity)), d(0));
      shaped.push({
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        itemType: item.itemType,
        category: item.category.name,
        unit: item.unit.code,
        warehouseId: '',
        warehouse: 'No stock yet',
        quantity: qty(onHand),
        reorderLevel: qty(item.reorderLevel),
        standardCost: money(item.standardCost),
        value: money(onHand.mul(d(item.standardCost))),
        totalOnHand: qty(onHand),
        packing: null,
      });
    }
  } else {
    shaped = shaped.filter((row) => d(row.quantity).greaterThan(0));
  }
  const total = shaped.length;
  return { total, data: slicePage(shaped, query.page, query.pageSize) };
}

export async function stockOnHand(warehouseId: string) {
  const rows = await prisma.stockBalance.findMany({ where: { warehouseId } });
  return rows.map((row) => ({ itemId: row.itemId, quantity: qty(row.quantity) }));
}

const MOVEMENT_LABEL: Record<string, string> = {
  PURCHASE_IN: 'Purchase in',
  PURCHASE_REVERSAL_OUT: 'Purchase reversal out',
  PRODUCTION_IN: 'Production in',
  PRODUCTION_OUT: 'Production out',
  PRODUCTION_REVERSAL_IN: 'Production reversal in',
  PRODUCTION_REVERSAL_OUT: 'Production reversal out',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_REVERSAL_IN: 'Transfer reversal in',
  TRANSFER_REVERSAL_OUT: 'Transfer reversal out',
  SHIPMENT_OUT: 'Shipment out',
  SHIPMENT_REVERSAL_IN: 'Shipment reversal in',
  ADJUSTMENT_IN: 'Adjustment in',
  ADJUSTMENT_OUT: 'Adjustment out',
  ADJUSTMENT_REVERSAL_IN: 'Adjustment reversal in',
  ADJUSTMENT_REVERSAL_OUT: 'Adjustment reversal out',
};

export async function ledgerReport(query: ReportQuery, exportAll = false): Promise<Tabular> {
  const where: Prisma.StockLedgerWhereInput = {
    ...(query.itemId ? { itemId: query.itemId } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.from || query.to ? { movementDate: inRange({}, query.from, query.to) } : {}),
  };
  const rows = await prisma.stockLedger.findMany({
    where,
    orderBy: [{ movementDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: 5000,
  });
  const openingGroups = query.from
    ? await prisma.stockLedger.groupBy({
        by: ['itemId', 'warehouseId'],
        where: {
          movementDate: { lt: parseDate(query.from) },
          ...(query.itemId ? { itemId: query.itemId } : {}),
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        },
        _sum: { qtyIn: true, qtyOut: true },
      })
    : [];
  const running = new Map<string, Prisma.Decimal>();
  for (const group of openingGroups) {
    running.set(
      `${group.itemId}:${group.warehouseId}`,
      d(group._sum.qtyIn ?? 0).minus(d(group._sum.qtyOut ?? 0)),
    );
  }
  const itemIds = [...new Set(rows.map((row) => row.itemId))];
  const warehouseIds = [...new Set(rows.map((row) => row.warehouseId))];
  const [items, warehouses] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: itemIds } }, include: { unit: true } }),
    prisma.warehouse.findMany({ where: { id: { in: warehouseIds } } }),
  ]);
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const warehouseMap = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
  const shaped = rows.map((row) => {
    const key = `${row.itemId}:${row.warehouseId}`;
    const next = (running.get(key) ?? d(0)).plus(d(row.qtyIn)).minus(d(row.qtyOut));
    running.set(key, next);
    const item = itemMap.get(row.itemId);
    return {
      movementDate: formatDate(row.movementDate),
      movementType: MOVEMENT_LABEL[row.movementType] ?? row.movementType,
      referenceNo: row.referenceNo,
      sku: item?.sku ?? '',
      item: item?.name ?? '',
      unit: item?.unit.code ?? '',
      warehouse: warehouseMap.get(row.warehouseId)?.name ?? '',
      qtyIn: qty(row.qtyIn),
      qtyOut: qty(row.qtyOut),
      balance: qty(next),
    };
  });
  const pageRows = exportAll ? shaped : slicePage(shaped, query.page, query.pageSize);
  return {
    title: 'Stock ledger',
    kpis: [
      { label: 'Movements', value: String(shaped.length) },
      { label: 'Quantity in', value: qty(shaped.reduce((sum, row) => sum.plus(d(row.qtyIn)), d(0))) },
      { label: 'Quantity out', value: qty(shaped.reduce((sum, row) => sum.plus(d(row.qtyOut)), d(0))) },
    ],
    columns: [
      { key: 'movementDate', label: 'Date' },
      { key: 'movementType', label: 'Type' },
      { key: 'referenceNo', label: 'Reference' },
      { key: 'sku', label: 'SKU' },
      { key: 'item', label: 'Item' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'qtyIn', label: 'In', type: 'qty' },
      { key: 'qtyOut', label: 'Out', type: 'qty' },
      { key: 'balance', label: 'Balance', type: 'qty' },
      { key: 'unit', label: 'Unit' },
    ],
    rows: pageRows,
    total: shaped.length,
    truncated: rows.length === 5000,
  };
}

export async function stockSummaryReport(query: ReportQuery, exportAll = false): Promise<Tabular> {
  const itemWhere: Prisma.ItemWhereInput = {
    deletedAt: null,
    ...(query.itemId ? { id: query.itemId } : {}),
    ...(query.itemType ? { itemType: query.itemType } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.search
      ? {
          OR: [
            { sku: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  if (query.to) {
    const groups = await prisma.stockLedger.groupBy({
      by: ['itemId', 'warehouseId'],
      where: {
        movementDate: { lte: parseDate(query.to) },
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.itemId ? { itemId: query.itemId } : {}),
      },
      _sum: { qtyIn: true, qtyOut: true },
    });
    const items = await prisma.item.findMany({ where: itemWhere, include: { unit: true, category: true } });
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const warehouses = await prisma.warehouse.findMany({
      where: { ...(query.warehouseId ? { id: query.warehouseId } : {}) },
    });
    const warehouseMap = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
    const totals = new Map<string, Prisma.Decimal>();
    for (const group of groups) {
      const net = d(group._sum.qtyIn ?? 0).minus(d(group._sum.qtyOut ?? 0));
      totals.set(group.itemId, (totals.get(group.itemId) ?? d(0)).plus(net));
    }
    let rows = groups
      .map((group) => {
        const item = itemMap.get(group.itemId);
        if (!item) return null;
        const net = d(group._sum.qtyIn ?? 0).minus(d(group._sum.qtyOut ?? 0));
        if (query.belowReorder !== 'true' && net.equals(0)) return null;
        return {
          sku: item.sku,
          item: item.name,
          itemType: item.itemType,
          category: item.category.name,
          warehouse: warehouseMap.get(group.warehouseId)?.name ?? '',
          unit: item.unit.code,
          onHand: qty(net),
          reorderLevel: qty(item.reorderLevel),
          standardCost: money(item.standardCost),
          value: money(net.mul(d(item.standardCost))),
          itemId: item.id,
          net,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (query.belowReorder === 'true') {
      rows = rows.filter((row) => {
        const item = itemMap.get(row.itemId);
        if (!item || d(item.reorderLevel).lessThanOrEqualTo(0)) return false;
        return (totals.get(row.itemId) ?? d(0)).lessThanOrEqualTo(item.reorderLevel);
      });
    }
    const value = rows.reduce((sum, row) => sum.plus(d(row.value)), d(0));
    const pageRows = (exportAll ? rows : slicePage(rows, query.page, query.pageSize)).map(({ net: _net, itemId: _id, ...row }) => row);
    return {
      title: 'Stock summary',
      kpis: [
        { label: 'Rows', value: String(rows.length) },
        { label: 'Stock value', value: money(value) },
      ],
      columns: summaryColumns(),
      rows: pageRows,
      total: rows.length,
    };
  }
  const all = await stockBalances({ ...query, page: 1, pageSize: 5000 });
  const value = all.data.reduce((sum, row) => sum.plus(d(row.value)), d(0));
  const visible = exportAll ? all.data : slicePage(all.data, query.page, query.pageSize);
  const rows = visible.map((row) => ({
    sku: row.sku,
    item: row.name,
    itemType: row.itemType,
    category: row.category,
    warehouse: row.warehouse,
    unit: row.unit,
    onHand: row.quantity,
    reorderLevel: row.reorderLevel,
    standardCost: row.standardCost,
    value: row.value,
  }));
  return {
    title: 'Stock summary',
    kpis: [
      { label: 'Rows', value: String(all.total) },
      { label: 'Stock value', value: money(value) },
    ],
    columns: summaryColumns(),
    rows,
    total: all.total,
  };
}

function summaryColumns(): Column[] {
  return [
    { key: 'sku', label: 'SKU' },
    { key: 'item', label: 'Item' },
    { key: 'itemType', label: 'Type' },
    { key: 'category', label: 'Category' },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'onHand', label: 'On hand', type: 'qty' },
    { key: 'unit', label: 'Unit' },
    { key: 'reorderLevel', label: 'Reorder', type: 'qty' },
    { key: 'standardCost', label: 'Standard cost', type: 'money' },
    { key: 'value', label: 'Value', type: 'money' },
  ];
}

export async function purchaseReport(query: ReportQuery, exportAll = false): Promise<Tabular> {
  const docs = await prisma.purchase.findMany({
    where: {
      deletedAt: null,
      status: { in: POSTED },
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.from || query.to ? { invoiceDate: inRange({}, query.from, query.to) } : {}),
      ...(query.itemId ? { lines: { some: { itemId: query.itemId } } } : {}),
    },
    include: {
      supplier: true,
      warehouse: true,
      lines: { include: { item: { include: { unit: true } } } },
    },
    orderBy: { invoiceDate: 'desc' },
  });
  const rows = docs.flatMap((doc) =>
    doc.lines
      .filter((line) => !query.itemId || line.itemId === query.itemId)
      .map((line) => ({
        docNo: doc.docNo,
        invoiceNo: doc.invoiceNo,
        invoiceDate: formatDate(doc.invoiceDate),
        supplier: doc.supplier.name,
        warehouse: doc.warehouse.name,
        status: doc.status,
        sku: line.item.sku,
        item: line.item.name,
        quantity: qty(line.quantity),
        unit: line.item.unit.code,
        unitPrice: money(line.unitPrice),
        lineTotal: money(line.lineTotal),
      })),
  );
  const value = rows.reduce((sum, row) => sum.plus(d(row.lineTotal)), d(0));
  return {
    title: 'Purchases',
    kpis: [
      { label: 'Documents', value: String(docs.length) },
      { label: 'Line value', value: money(value) },
    ],
    columns: [
      { key: 'docNo', label: 'Document' },
      { key: 'invoiceNo', label: 'Invoice' },
      { key: 'invoiceDate', label: 'Date' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'sku', label: 'SKU' },
      { key: 'item', label: 'Item' },
      { key: 'quantity', label: 'Quantity', type: 'qty' },
      { key: 'unit', label: 'Unit' },
      { key: 'unitPrice', label: 'Unit price', type: 'money' },
      { key: 'lineTotal', label: 'Line total', type: 'money' },
      { key: 'status', label: 'Status' },
    ],
    rows: exportAll ? rows : slicePage(rows, query.page, query.pageSize),
    total: rows.length,
  };
}

export async function productionReport(query: ReportQuery, exportAll = false): Promise<Tabular> {
  const docs = await prisma.production.findMany({
    where: {
      deletedAt: null,
      status: { in: POSTED },
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.from || query.to ? { producedOn: inRange({}, query.from, query.to) } : {}),
      ...(query.itemId
        ? { OR: [{ finishedItemId: query.itemId }, { lines: { some: { itemId: query.itemId } } }] }
        : {}),
    },
    include: {
      finishedItem: { include: { unit: true } },
      warehouse: true,
      lines: { include: { item: { include: { unit: true } } } },
    },
    orderBy: { producedOn: 'desc' },
  });
  const rows = docs.flatMap((doc) => {
    const output = {
      docNo: doc.docNo,
      producedOn: formatDate(doc.producedOn),
      batchNo: doc.batchNo,
      warehouse: doc.warehouse.name,
      lineKind: 'Output',
      sku: doc.finishedItem.sku,
      item: doc.finishedItem.name,
      quantity: qty(doc.quantity),
      unit: doc.finishedItem.unit.code,
      status: doc.status,
    };
    const components = doc.lines
      .filter((line) => !query.itemId || line.itemId === query.itemId || doc.finishedItemId === query.itemId)
      .map((line) => ({
        docNo: doc.docNo,
        producedOn: formatDate(doc.producedOn),
        batchNo: doc.batchNo,
        warehouse: doc.warehouse.name,
        lineKind: 'Consumption',
        sku: line.item.sku,
        item: line.item.name,
        quantity: qty(line.quantity),
        unit: line.item.unit.code,
        status: doc.status,
      }));
    if (query.itemId && doc.finishedItemId !== query.itemId && !doc.lines.some((line) => line.itemId === query.itemId)) {
      return [];
    }
    const showOutput = !query.itemId || doc.finishedItemId === query.itemId;
    return [...(showOutput ? [output] : []), ...components];
  });
  return {
    title: 'Production',
    kpis: [
      { label: 'Batches', value: String(docs.length) },
      { label: 'Rows', value: String(rows.length) },
    ],
    columns: [
      { key: 'docNo', label: 'Document' },
      { key: 'producedOn', label: 'Date' },
      { key: 'batchNo', label: 'Batch' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'lineKind', label: 'Line' },
      { key: 'sku', label: 'SKU' },
      { key: 'item', label: 'Item' },
      { key: 'quantity', label: 'Quantity', type: 'qty' },
      { key: 'unit', label: 'Unit' },
      { key: 'status', label: 'Status' },
    ],
    rows: exportAll ? rows : slicePage(rows, query.page, query.pageSize),
    total: rows.length,
  };
}

export async function shipmentReport(query: ReportQuery, exportAll = false): Promise<Tabular> {
  const docs = await prisma.shipment.findMany({
    where: {
      deletedAt: null,
      status: { in: POSTED },
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.from || query.to ? { shipmentDate: inRange({}, query.from, query.to) } : {}),
      ...(query.itemId ? { lines: { some: { itemId: query.itemId } } } : {}),
    },
    include: {
      customer: true,
      warehouse: true,
      lines: { include: { item: { include: { unit: true } } } },
    },
    orderBy: { shipmentDate: 'desc' },
  });
  const rows = docs.flatMap((doc) =>
    doc.lines
      .filter((line) => !query.itemId || line.itemId === query.itemId)
      .map((line) => ({
        docNo: doc.docNo,
        shipmentDate: formatDate(doc.shipmentDate),
        customer: doc.customer.name,
        warehouse: doc.warehouse.name,
        vehicleNo: doc.vehicleNo,
        sku: line.item.sku,
        item: line.item.name,
        quantity: qty(line.quantity),
        unit: line.item.unit.code,
        unitPrice: money(line.unitPrice),
        lineTotal: money(line.lineTotal),
        status: doc.status,
      })),
  );
  const value = rows.reduce((sum, row) => sum.plus(d(row.lineTotal)), d(0));
  return {
    title: 'Shipments',
    kpis: [
      { label: 'Shipments', value: String(docs.length) },
      { label: 'Sales value', value: money(value) },
    ],
    columns: [
      { key: 'docNo', label: 'Document' },
      { key: 'shipmentDate', label: 'Date' },
      { key: 'customer', label: 'Customer' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'vehicleNo', label: 'Vehicle' },
      { key: 'sku', label: 'SKU' },
      { key: 'item', label: 'Item' },
      { key: 'quantity', label: 'Quantity', type: 'qty' },
      { key: 'unit', label: 'Unit' },
      { key: 'unitPrice', label: 'Unit price', type: 'money' },
      { key: 'lineTotal', label: 'Line total', type: 'money' },
      { key: 'status', label: 'Status' },
    ],
    rows: exportAll ? rows : slicePage(rows, query.page, query.pageSize),
    total: rows.length,
  };
}

export async function transferReport(query: ReportQuery, exportAll = false): Promise<Tabular> {
  const docs = await prisma.transfer.findMany({
    where: {
      deletedAt: null,
      status: { in: POSTED },
      ...(query.warehouseId
        ? { OR: [{ sourceWarehouseId: query.warehouseId }, { destinationWarehouseId: query.warehouseId }] }
        : {}),
      ...(query.from || query.to ? { transferDate: inRange({}, query.from, query.to) } : {}),
      ...(query.itemId ? { lines: { some: { itemId: query.itemId } } } : {}),
    },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      lines: { include: { item: { include: { unit: true } } } },
    },
    orderBy: { transferDate: 'desc' },
  });
  const rows = docs.flatMap((doc) =>
    doc.lines
      .filter((line) => !query.itemId || line.itemId === query.itemId)
      .map((line) => ({
        docNo: doc.docNo,
        transferDate: formatDate(doc.transferDate),
        route: `${doc.sourceWarehouse.name} → ${doc.destinationWarehouse.name}`,
        sku: line.item.sku,
        item: line.item.name,
        quantity: qty(line.quantity),
        unit: line.item.unit.code,
        status: doc.status,
      })),
  );
  return {
    title: 'Transfer log',
    kpis: [
      { label: 'Transfers', value: String(docs.length) },
      { label: 'Lines', value: String(rows.length) },
    ],
    columns: [
      { key: 'docNo', label: 'Transfer' },
      { key: 'transferDate', label: 'Date' },
      { key: 'route', label: 'Route' },
      { key: 'sku', label: 'SKU' },
      { key: 'item', label: 'Item' },
      { key: 'quantity', label: 'Quantity', type: 'qty' },
      { key: 'unit', label: 'Unit' },
      { key: 'status', label: 'Status' },
    ],
    rows: exportAll ? rows : slicePage(rows, query.page, query.pageSize),
    total: rows.length,
  };
}
