import {
  DocStatus,
  DocType,
  PermissionModule,
  Prisma,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { writeAudit } from '../lib/audit';
import { attachPeople, nameMap, nextDocNo } from '../lib/docs';
import { businessToday, formatDate, parseDate } from '../lib/dates';
import { conflict, forbidden, notFound, validation } from '../lib/errors';
import { d, lineTotal, money, qty, sumMoney } from '../lib/money';
import { hasPerm, type ModuleName } from '../lib/permissions';
import type { AuthUser } from '../types';
import type { z } from 'zod';
import {
  adjustmentSchema,
  docListSchema,
  productionSchema,
  purchaseSchema,
  shipmentSchema,
  transferSchema,
} from '../lib/validators';
import { applyMovements, type MovementDraft } from './stock';
import { grossWeightKg, netWeightKg, slabsFromCases, splitSlabs } from '../lib/packing';
import { notifyDecision, notifyLowStock, queueApprovalRequest, sendApprovalEmails } from './notify';

type Tx = Prisma.TransactionClient;
type DocQuery = z.infer<typeof docListSchema>;

type Patch = {
  status?: DocStatus;
  submittedById?: string | null;
  submittedAt?: Date | null;
  approvedById?: string | null;
  approvedAt?: Date | null;
  rejectedById?: string | null;
  rejectedAt?: Date | null;
  rejectionRemarks?: string | null;
  postedAt?: Date | null;
  deletedAt?: Date | null;
};

type Loaded = {
  id: string;
  docNo: string;
  status: DocStatus;
  isReversal: boolean;
  reversalOfId: string | null;
  createdById: string;
  submittedById: string | null;
  deletedAt: Date | null;
};

type Adapter = {
  docType: DocType;
  module: ModuleName;
  label: string;
  load: (id: string) => Promise<Loaded>;
  loadTx: (tx: Tx, id: string) => Promise<Loaded | null>;
  patch: (tx: Tx, id: string, data: Patch) => Promise<void>;
  claim: (tx: Tx, id: string, from: DocStatus, data: Patch) => Promise<number>;
  movements: (doc: Loaded) => MovementDraft[];
  summary: (doc: Loaded) => string;
  amount: (doc: Loaded) => string;
  snapshot: (doc: Loaded) => unknown;
  markReversed: (tx: Tx, id: string) => Promise<void>;
};

function ensure(user: AuthUser, module: ModuleName, action: 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE' | 'APPROVE') {
  if (!hasPerm(user.permissions, module, action)) {
    throw forbidden(`Your role cannot ${action.toLowerCase()} ${module.replaceAll('_', ' ').toLowerCase()}.`);
  }
}

async function assertWarehouse(tx: Tx, id: string) {
  const row = await tx.warehouse.findFirst({ where: { id, deletedAt: null, isActive: true } });
  if (!row) throw validation('Choose an active warehouse.');
  return row;
}

async function assertSupplier(tx: Tx, id: string) {
  const row = await tx.supplier.findFirst({ where: { id, deletedAt: null, isActive: true } });
  if (!row) throw validation('Choose an active supplier.');
  return row;
}

async function assertCustomer(tx: Tx, id: string) {
  const row = await tx.customer.findFirst({ where: { id, deletedAt: null, isActive: true } });
  if (!row) throw validation('Choose an active customer.');
  return row;
}

async function assertItems(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids)];
  const items = await tx.item.findMany({
    where: { id: { in: unique }, deletedAt: null, isActive: true },
    include: { unit: true },
  });
  if (items.length !== unique.length) throw validation('One or more items are inactive or missing.');
  return new Map(items.map((item) => [item.id, item]));
}

function priceLines(lines: Array<{ itemId: string; quantity: string; unitPrice: string }>) {
  return lines.map((line, index) => ({
    itemId: line.itemId,
    quantity: qty(line.quantity),
    unitPrice: money(line.unitPrice),
    lineTotal: lineTotal(line.quantity, line.unitPrice),
    sortOrder: index,
  }));
}

type CaseLineInput = {
  itemId: string;
  quantity?: string;
  cases?: string;
  looseSlabs?: string;
};

async function resolvePacking(tx: Tx, itemId: string) {
  return tx.packingConfiguration.findFirst({ where: { finishedItemId: itemId, isActive: true } });
}

/**
 * Resolve a transfer/shipment line to slab quantities.
 * Lines may carry a plain quantity, or a case-based entry (cases + loose slabs)
 * which requires an active packing configuration on the item.
 */
async function slabQtyForLine(tx: Tx, line: CaseLineInput) {
  const useCases = line.cases !== undefined || line.looseSlabs !== undefined;
  if (!useCases) {
    if (line.quantity === undefined) throw validation('Enter a quantity, or cases / loose slabs.');
    return { quantity: qty(line.quantity), cases: null as string | null, looseSlabs: null as string | null, netWeightKg: null as string | null };
  }
  const config = await resolvePacking(tx, line.itemId);
  if (!config) throw validation('Cases can only be entered for items with a packing configuration.');
  let quantity: string;
  try {
    quantity = slabsFromCases(line.cases ?? '0', line.looseSlabs ?? '0.000', config.slabsPerCase);
  } catch {
    throw validation('Cases / loose slabs must total more than zero.');
  }
  return {
    quantity,
    cases: qty(line.cases ?? '0'),
    looseSlabs: qty(line.looseSlabs ?? '0.000'),
    netWeightKg: netWeightKg(quantity, config.slabWeightKg),
  };
}

async function caseQtyLines(tx: Tx, lines: CaseLineInput[]) {
  const resolved: Array<{ itemId: string; quantity: string; cases: string | null; looseSlabs: string | null; sortOrder: number }> = [];
  for (const [index, line] of lines.entries()) {
    const r = await slabQtyForLine(tx, line);
    resolved.push({ itemId: line.itemId, quantity: r.quantity, cases: r.cases, looseSlabs: r.looseSlabs, sortOrder: index });
  }
  return resolved;
}

async function casePriceLines(tx: Tx, lines: Array<CaseLineInput & { unitPrice: string }>) {
  const resolved: Array<{
    itemId: string; quantity: string; cases: string | null; looseSlabs: string | null;
    netWeightKg: string | null; unitPrice: string; lineTotal: string; sortOrder: number;
  }> = [];
  for (const [index, line] of lines.entries()) {
    const r = await slabQtyForLine(tx, line);
    resolved.push({
      itemId: line.itemId,
      quantity: r.quantity,
      cases: r.cases,
      looseSlabs: r.looseSlabs,
      netWeightKg: r.netWeightKg,
      unitPrice: money(line.unitPrice),
      lineTotal: lineTotal(r.quantity, line.unitPrice),
      sortOrder: index,
    });
  }
  return resolved;
}

async function assertSourcePurchases(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const count = await tx.purchase.count({ where: { id: { in: unique }, deletedAt: null } });
  if (count !== unique.length) throw validation('One or more source purchases are missing.');
}

async function assertSourceProductions(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const count = await tx.production.count({ where: { id: { in: unique }, deletedAt: null } });
  if (count !== unique.length) throw validation('One or more source production batches are missing.');
}

async function withPeople<T extends Loaded & {
  approvedById?: string | null;
  rejectedById?: string | null;
}>(rows: T[]) {
  const people = await nameMap(rows.flatMap((row) => [row.createdById, row.submittedById, row.approvedById, row.rejectedById]));
  return rows.map((row) => attachPeople(row, people));
}

const purchaseInclude = {
  supplier: true,
  warehouse: true,
  lines: { include: { item: { include: { unit: true } } }, orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.PurchaseInclude;

const productionInclude = {
  finishedItem: { include: { unit: true, packingConfig: true } },
  warehouse: true,
  lines: { include: { item: { include: { unit: true } } }, orderBy: { sortOrder: 'asc' as const } },
  sources: { include: { purchase: { select: { id: true, docNo: true } } } },
} satisfies Prisma.ProductionInclude;

const transferInclude = {
  sourceWarehouse: true,
  destinationWarehouse: true,
  lines: { include: { item: { include: { unit: true, packingConfig: true } } }, orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.TransferInclude;

const shipmentInclude = {
  customer: true,
  warehouse: true,
  lines: { include: { item: { include: { unit: true, packingConfig: true } } }, orderBy: { sortOrder: 'asc' as const } },
  sources: { include: { production: { select: { id: true, docNo: true } } } },
} satisfies Prisma.ShipmentInclude;

const adjustmentInclude = {
  warehouse: true,
  lines: { include: { item: { include: { unit: true } } }, orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.StockAdjustmentInclude;

async function submitDoc(adapter: Adapter, id: string, user: AuthUser) {
  ensure(user, adapter.module, 'CREATE');
  const mailed = await prisma.$transaction(async (tx) => {
    const doc = await adapter.loadTx(tx, id);
    if (!doc) throw notFound(adapter.label);
    if (doc.status !== 'DRAFT') throw conflict('Only drafts can be submitted.');
    await adapter.patch(tx, id, {
      status: 'PENDING_APPROVAL',
      submittedById: user.id,
      submittedAt: new Date(),
      rejectedById: null,
      rejectedAt: null,
      rejectionRemarks: null,
    });
    await tx.approvalTask.create({
      data: {
        docType: adapter.docType,
        docId: id,
        docNo: doc.docNo,
        summary: adapter.summary(doc),
        amount: adapter.amount(doc),
        module: adapter.module as PermissionModule,
        submittedById: user.id,
      },
    });
    const updated = await adapter.loadTx(tx, id);
    await writeAudit(tx, {
      userId: user.id,
      action: 'SUBMIT',
      entityType: adapter.docType,
      entityId: id,
      summary: `Submitted ${doc.docNo} for approval`,
      before: adapter.snapshot(doc),
      after: updated ? adapter.snapshot(updated) : undefined,
    });
    const recipients = await queueApprovalRequest(tx, {
      module: adapter.module as PermissionModule,
      docNo: doc.docNo,
      docTypeLabel: adapter.label,
      summary: adapter.summary(doc),
      entityType: adapter.docType,
      entityId: id,
      submitterId: user.id,
    });
    return { recipients, docNo: doc.docNo, summary: adapter.summary(doc) };
  });
  sendApprovalEmails(
    mailed.recipients,
    `${adapter.label} ${mailed.docNo} is waiting for approval`,
    mailed.summary,
  );
  return adapter.load(id);
}

async function approveDoc(adapter: Adapter, id: string, user: AuthUser, remarks?: string | null) {
  ensure(user, adapter.module, 'APPROVE');
  ensure(user, 'APPROVALS', 'APPROVE');
  const outcome = await prisma.$transaction(async (tx) => {
    const doc = await adapter.loadTx(tx, id);
    if (!doc) throw notFound(adapter.label);
    if (doc.status !== 'PENDING_APPROVAL') throw conflict('Only documents waiting for approval can be approved.');
    const count = await adapter.claim(tx, id, 'PENDING_APPROVAL', {
      status: 'POSTED',
      approvedById: user.id,
      approvedAt: new Date(),
      postedAt: new Date(),
    });
    if (count !== 1) throw conflict('This document is no longer pending.');
    const touched = await applyMovements(tx, adapter.movements(doc), user.id);
    if (doc.isReversal && doc.reversalOfId) await adapter.markReversed(tx, doc.reversalOfId);
    await tx.approvalTask.updateMany({
      where: { docType: adapter.docType, docId: id, status: 'PENDING' },
      data: { status: 'APPROVED', decidedById: user.id, decidedAt: new Date(), remarks: remarks || null },
    });
    const updated = await adapter.loadTx(tx, id);
    await writeAudit(tx, {
      userId: user.id,
      action: 'APPROVE',
      entityType: adapter.docType,
      entityId: id,
      summary: `Approved and posted ${doc.docNo}`,
      before: adapter.snapshot(doc),
      after: updated ? adapter.snapshot(updated) : undefined,
    });
    await notifyLowStock(tx, touched);
    return { userId: doc.submittedById ?? doc.createdById, docNo: doc.docNo };
  }, { timeout: 20000 });
  const submitter = await prisma.user.findUnique({ where: { id: outcome.userId } });
  if (submitter) {
    await notifyDecision({
      userId: submitter.id,
      email: submitter.email,
      approved: true,
      docNo: outcome.docNo,
      docTypeLabel: adapter.label,
      remarks: remarks ?? null,
      entityType: adapter.docType,
      entityId: id,
    });
  }
  return adapter.load(id);
}

async function rejectDoc(adapter: Adapter, id: string, user: AuthUser, remarks: string) {
  ensure(user, adapter.module, 'APPROVE');
  ensure(user, 'APPROVALS', 'APPROVE');
  const outcome = await prisma.$transaction(async (tx) => {
    const doc = await adapter.loadTx(tx, id);
    if (!doc) throw notFound(adapter.label);
    const count = await adapter.claim(tx, id, 'PENDING_APPROVAL', {
      status: 'REJECTED',
      rejectedById: user.id,
      rejectedAt: new Date(),
      rejectionRemarks: remarks,
    });
    if (count !== 1) throw conflict('This document is no longer pending.');
    await tx.approvalTask.updateMany({
      where: { docType: adapter.docType, docId: id, status: 'PENDING' },
      data: { status: 'REJECTED', decidedById: user.id, decidedAt: new Date(), remarks },
    });
    const updated = await adapter.loadTx(tx, id);
    await writeAudit(tx, {
      userId: user.id,
      action: 'REJECT',
      entityType: adapter.docType,
      entityId: id,
      summary: `Rejected ${doc.docNo}`,
      before: adapter.snapshot(doc),
      after: updated ? adapter.snapshot(updated) : undefined,
    });
    return { userId: doc.submittedById ?? doc.createdById, docNo: doc.docNo };
  });
  const submitter = await prisma.user.findUnique({ where: { id: outcome.userId } });
  if (submitter) {
    await notifyDecision({
      userId: submitter.id,
      email: submitter.email,
      approved: false,
      docNo: outcome.docNo,
      docTypeLabel: adapter.label,
      remarks,
      entityType: adapter.docType,
      entityId: id,
    });
  }
  return adapter.load(id);
}

async function reopenDoc(adapter: Adapter, id: string, user: AuthUser) {
  ensure(user, adapter.module, 'EDIT');
  await prisma.$transaction(async (tx) => {
    const doc = await adapter.loadTx(tx, id);
    if (!doc) throw notFound(adapter.label);
    if (doc.status !== 'REJECTED') throw conflict('Only rejected documents can be reopened.');
    await adapter.patch(tx, id, {
      status: 'DRAFT',
      rejectedById: null,
      rejectedAt: null,
      rejectionRemarks: null,
    });
    const updated = await adapter.loadTx(tx, id);
    await writeAudit(tx, {
      userId: user.id,
      action: 'UPDATE',
      entityType: adapter.docType,
      entityId: id,
      summary: `Reopened ${doc.docNo} as a draft`,
      before: adapter.snapshot(doc),
      after: updated ? adapter.snapshot(updated) : undefined,
    });
  });
  return adapter.load(id);
}

async function deleteDraft(adapter: Adapter, id: string, user: AuthUser) {
  ensure(user, adapter.module, 'DELETE');
  await prisma.$transaction(async (tx) => {
    const doc = await adapter.loadTx(tx, id);
    if (!doc) throw notFound(adapter.label);
    const count = await adapter.claim(tx, id, 'DRAFT', { deletedAt: new Date() });
    if (count !== 1) throw conflict('Only drafts can be deleted. Reject a pending document, or reverse a posted one.');
    await writeAudit(tx, {
      userId: user.id,
      action: 'DELETE',
      entityType: adapter.docType,
      entityId: id,
      summary: `Deleted draft ${doc.docNo}`,
      before: adapter.snapshot(doc),
    });
  });
  return { id, deleted: true };
}

function editable(status: DocStatus) {
  if (status === 'REJECTED') throw conflict('Reopen the document before editing it.');
  if (status !== 'DRAFT') throw conflict('Posted documents stay as they are. Create a reversal or a stock adjustment.');
}

async function assertNoOpenReversal(model: 'purchase' | 'production' | 'transfer' | 'shipment' | 'stockAdjustment', id: string, docNoLabel: string) {
  const existing = await (prisma[model] as unknown as {
    findFirst: (args: unknown) => Promise<{ docNo: string } | null>;
  }).findFirst({
    where: {
      reversalOfId: id,
      deletedAt: null,
      status: { in: ['DRAFT', 'PENDING_APPROVAL', 'POSTED'] },
    },
    select: { docNo: true },
  });
  if (existing) throw conflict(`Reversal ${existing.docNo} already covers ${docNoLabel}.`);
}

function movementBase(doc: { id: string; docNo: string }, date: Date, referenceType: DocType) {
  return { referenceType, referenceId: doc.id, referenceNo: doc.docNo, movementDate: date };
}

export async function getPurchase(id: string) {
  const doc = await prisma.purchase.findFirst({ where: { id, deletedAt: null }, include: purchaseInclude });
  if (!doc) throw notFound('Purchase');
  const [row] = await withPeople([doc]);
  return row;
}

export async function listPurchases(query: DocQuery) {
  const where: Prisma.PurchaseWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.from || query.to
      ? {
          invoiceDate: {
            ...(query.from ? { gte: parseDate(query.from) } : {}),
            ...(query.to ? { lte: parseDate(query.to) } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { docNo: { contains: query.search, mode: 'insensitive' } },
            { invoiceNo: { contains: query.search, mode: 'insensitive' } },
            { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const orderBy =
    query.sort === 'docNo'
      ? { docNo: query.order }
      : query.sort === 'date'
        ? { invoiceDate: query.order }
        : { createdAt: query.order };
  const [total, rows] = await prisma.$transaction([
    prisma.purchase.count({ where }),
    prisma.purchase.findMany({
      where,
      include: { ...purchaseInclude, _count: { select: { lines: true } } },
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { total, data: await withPeople(rows) };
}

async function assertInvoice(tx: Tx, supplierId: string, invoiceNo: string, exceptId?: string) {
  const existing = await tx.purchase.findFirst({
    where: {
      supplierId,
      invoiceNo,
      deletedAt: null,
      status: { not: 'REJECTED' },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
  });
  if (existing) throw conflict(`Invoice ${invoiceNo} is already used on ${existing.docNo}.`);
}

export async function createPurchase(input: z.infer<typeof purchaseSchema>, user: AuthUser, seedKey?: string) {
  ensure(user, 'PURCHASES', 'CREATE');
  if (seedKey) {
    const existing = await prisma.purchase.findUnique({ where: { seedKey } });
    if (existing && !existing.deletedAt) return getPurchase(existing.id);
  }
  const lines = priceLines(input.lines);
  const id = await prisma.$transaction(async (tx) => {
    await assertSupplier(tx, input.supplierId);
    await assertWarehouse(tx, input.warehouseId);
    await assertItems(tx, input.lines.map((line) => line.itemId));
    await assertInvoice(tx, input.supplierId, input.invoiceNo);
    const docNo = await nextDocNo(tx, 'PUR');
    const created = await tx.purchase.create({
      data: {
        docNo,
        seedKey,
        supplierId: input.supplierId,
        invoiceNo: input.invoiceNo,
        invoiceDate: parseDate(input.invoiceDate),
        warehouseId: input.warehouseId,
        notes: input.notes ?? '',
        totalAmount: sumMoney(lines.map((line) => line.lineTotal)),
        createdById: user.id,
        lines: { create: lines },
      },
      include: purchaseInclude,
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'CREATE',
      entityType: 'PURCHASE',
      entityId: created.id,
      summary: `Created ${created.docNo}`,
      after: purchaseSnapshot(created),
    });
    return created.id;
  });
  return getPurchase(id);
}

export async function updatePurchase(id: string, input: z.infer<typeof purchaseSchema>, user: AuthUser) {
  ensure(user, 'PURCHASES', 'EDIT');
  const lines = priceLines(input.lines);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findFirst({ where: { id, deletedAt: null }, include: purchaseInclude });
    if (!existing) throw notFound('Purchase');
    editable(existing.status);
    await assertSupplier(tx, input.supplierId);
    await assertWarehouse(tx, input.warehouseId);
    await assertItems(tx, input.lines.map((line) => line.itemId));
    await assertInvoice(tx, input.supplierId, input.invoiceNo, id);
    await tx.purchaseLine.deleteMany({ where: { purchaseId: id } });
    const updated = await tx.purchase.update({
      where: { id },
      data: {
        supplierId: input.supplierId,
        invoiceNo: input.invoiceNo,
        invoiceDate: parseDate(input.invoiceDate),
        warehouseId: input.warehouseId,
        notes: input.notes ?? '',
        totalAmount: sumMoney(lines.map((line) => line.lineTotal)),
        lines: { create: lines },
      },
      include: purchaseInclude,
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'UPDATE',
      entityType: 'PURCHASE',
      entityId: id,
      summary: `Updated ${existing.docNo}`,
      before: purchaseSnapshot(existing),
      after: purchaseSnapshot(updated),
    });
  });
  return getPurchase(id);
}

function purchaseSnapshot(doc: Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>) {
  return {
    status: doc.status,
    supplierId: doc.supplierId,
    invoiceNo: doc.invoiceNo,
    invoiceDate: formatDate(doc.invoiceDate),
    warehouseId: doc.warehouseId,
    notes: doc.notes,
    totalAmount: money(doc.totalAmount),
    isReversal: doc.isReversal,
    lines: doc.lines.map((line) => ({
      itemId: line.itemId,
      sku: line.item.sku,
      quantity: qty(line.quantity),
      unitPrice: money(line.unitPrice),
      lineTotal: money(line.lineTotal),
    })),
  };
}

function purchaseMovements(doc: Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>): MovementDraft[] {
  return doc.lines.map((line) => ({
    itemId: line.itemId,
    warehouseId: doc.warehouseId,
    qtyIn: doc.isReversal ? '0.000' : qty(line.quantity),
    qtyOut: doc.isReversal ? qty(line.quantity) : '0.000',
    movementType: doc.isReversal ? 'PURCHASE_REVERSAL_OUT' : 'PURCHASE_IN',
    ...movementBase(doc, doc.invoiceDate, 'PURCHASE'),
  }));
}

const purchaseAdapter: Adapter = {
  docType: 'PURCHASE',
  module: 'PURCHASES',
  label: 'Purchase',
  load: (id) => getPurchase(id),
  loadTx: (tx, id) => tx.purchase.findFirst({ where: { id, deletedAt: null }, include: purchaseInclude }),
  patch: async (tx, id, data) => {
    await tx.purchase.update({ where: { id }, data });
  },
  claim: async (tx, id, from, data) =>
    (await tx.purchase.updateMany({ where: { id, status: from, deletedAt: null }, data })).count,
  movements: (doc) => purchaseMovements(doc as Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>),
  summary: (doc) => {
    const row = doc as Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>;
    return `${row.supplier.name}, invoice ${row.invoiceNo}, ${money(row.totalAmount)} INR`;
  },
  amount: (doc) => money((doc as unknown as { totalAmount: Prisma.Decimal }).totalAmount),
  snapshot: (doc) => purchaseSnapshot(doc as Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>),
  markReversed: async (tx, id) => {
    await tx.purchase.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'REVERSED' } });
  },
};

export const submitPurchase = (id: string, user: AuthUser) => submitDoc(purchaseAdapter, id, user);
export const approvePurchase = (id: string, user: AuthUser, remarks?: string | null) =>
  approveDoc(purchaseAdapter, id, user, remarks);
export const rejectPurchase = (id: string, user: AuthUser, remarks: string) => rejectDoc(purchaseAdapter, id, user, remarks);
export const reopenPurchase = (id: string, user: AuthUser) => reopenDoc(purchaseAdapter, id, user);
export const deletePurchase = (id: string, user: AuthUser) => deleteDraft(purchaseAdapter, id, user);

export async function reversePurchase(id: string, user: AuthUser) {
  ensure(user, 'PURCHASES', 'CREATE');
  const doc = await prisma.purchase.findFirst({ where: { id, deletedAt: null }, include: purchaseInclude });
  if (!doc) throw notFound('Purchase');
  if (doc.status !== 'POSTED') throw conflict('Only posted purchases can be reversed.');
  if (doc.isReversal) throw conflict('Use a stock adjustment to correct a reversal.');
  await assertNoOpenReversal('purchase', id, doc.docNo);
  const createdId = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'PUR');
    let invoiceNo = `${doc.invoiceNo}-R`.slice(0, 60);
    const clash = await tx.purchase.findFirst({
      where: { supplierId: doc.supplierId, invoiceNo, deletedAt: null, status: { not: 'REJECTED' } },
    });
    if (clash) invoiceNo = `${doc.invoiceNo}-R2`.slice(0, 60);
    const created = await tx.purchase.create({
      data: {
        docNo,
        supplierId: doc.supplierId,
        invoiceNo,
        invoiceDate: parseDate(businessToday()),
        warehouseId: doc.warehouseId,
        notes: `Reversal of ${doc.docNo}. ${doc.notes}`.slice(0, 2000),
        totalAmount: doc.totalAmount,
        isReversal: true,
        reversalOfId: doc.id,
        createdById: user.id,
        lines: {
          create: doc.lines.map((line, index) => ({
            itemId: line.itemId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
            sortOrder: index,
          })),
        },
      },
      include: purchaseInclude,
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'REVERSE',
      entityType: 'PURCHASE',
      entityId: doc.id,
      summary: `Started reversal ${created.docNo} for ${doc.docNo}`,
      after: { reversalId: created.id, reversalNo: created.docNo },
    });
    return created.id;
  });
  return getPurchase(createdId);
}

export async function getProduction(id: string) {
  const doc = await prisma.production.findFirst({ where: { id, deletedAt: null }, include: productionInclude });
  if (!doc) throw notFound('Production');
  const [row] = await withPeople([doc]);
  return row;
}

async function productionLines(tx: Tx, input: z.infer<typeof productionSchema>) {
  const finished = await tx.item.findFirst({ where: { id: input.finishedItemId, deletedAt: null, isActive: true } });
  if (!finished || finished.itemType !== 'FINISHED_GOOD') throw validation('Choose an active finished good.');
  if (input.lines.some((line) => line.itemId === finished.id)) {
    throw validation('The finished good cannot be consumed on its own production entry.');
  }
  const items = await assertItems(tx, input.lines.map((line) => line.itemId));
  for (const item of items.values()) {
    if (item.itemType === 'FINISHED_GOOD') {
      throw validation('Consumption lines must be raw materials or packing materials.');
    }
  }
  let cost = d(0);
  const lines = input.lines.map((line, index) => {
    const item = items.get(line.itemId)!;
    cost = cost.plus(d(line.quantity).mul(d(item.standardCost)));
    return {
      itemId: line.itemId,
      quantity: qty(line.quantity),
      unitCost: money(item.standardCost),
      sortOrder: index,
    };
  });
  // Slab/case split: when the finished good has a packing configuration,
  // the produced quantity is slabs; derive whole cases + loose slabs.
  const packing = await resolvePacking(tx, finished.id);
  let packingResult: {
    slabsProduced: string;
    casesProduced: number;
    looseSlabs: string;
    netWeightKg: string;
  } | null = null;
  if (packing) {
    const split = splitSlabs(input.quantity, packing.slabsPerCase);
    packingResult = {
      slabsProduced: qty(input.quantity),
      casesProduced: split.cases,
      looseSlabs: split.looseSlabs,
      netWeightKg: netWeightKg(input.quantity, packing.slabWeightKg),
    };
  }
  return { lines, totalAmount: money(cost), packing: packingResult };
}

export async function listProductions(query: DocQuery) {
  const where: Prisma.ProductionWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.from || query.to
      ? {
          producedOn: {
            ...(query.from ? { gte: parseDate(query.from) } : {}),
            ...(query.to ? { lte: parseDate(query.to) } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { docNo: { contains: query.search, mode: 'insensitive' } },
            { batchNo: { contains: query.search, mode: 'insensitive' } },
            { finishedItem: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const orderBy =
    query.sort === 'docNo' ? { docNo: query.order } : query.sort === 'date' ? { producedOn: query.order } : { createdAt: query.order };
  const [total, rows] = await prisma.$transaction([
    prisma.production.count({ where }),
    prisma.production.findMany({
      where,
      include: { ...productionInclude, _count: { select: { lines: true } } },
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { total, data: await withPeople(rows) };
}

export async function createProduction(input: z.infer<typeof productionSchema>, user: AuthUser, seedKey?: string) {
  ensure(user, 'PRODUCTION', 'CREATE');
  if (seedKey) {
    const existing = await prisma.production.findUnique({ where: { seedKey } });
    if (existing && !existing.deletedAt) return getProduction(existing.id);
  }
  const id = await prisma.$transaction(async (tx) => {
    await assertWarehouse(tx, input.warehouseId);
    const built = await productionLines(tx, input);
    await assertSourcePurchases(tx, input.sourcePurchaseIds ?? []);
    const docNo = await nextDocNo(tx, 'PRD');
    const created = await tx.production.create({
      data: {
        docNo,
        seedKey,
        finishedItemId: input.finishedItemId,
        quantity: qty(input.quantity),
        slabsProduced: built.packing?.slabsProduced ?? null,
        casesProduced: built.packing?.casesProduced ?? null,
        looseSlabs: built.packing?.looseSlabs ?? null,
        netWeightKg: built.packing?.netWeightKg ?? null,
        batchNo: input.batchNo,
        producedOn: parseDate(input.producedOn),
        warehouseId: input.warehouseId,
        notes: input.notes ?? '',
        totalAmount: built.totalAmount,
        createdById: user.id,
        lines: { create: built.lines },
        sources: {
          create: [...new Set(input.sourcePurchaseIds ?? [])].map((purchaseId) => ({ purchaseId })),
        },
      },
      include: productionInclude,
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'CREATE',
      entityType: 'PRODUCTION',
      entityId: created.id,
      summary: `Created ${created.docNo}`,
      after: productionSnapshot(created),
    });
    return created.id;
  });
  return getProduction(id);
}

export async function updateProduction(id: string, input: z.infer<typeof productionSchema>, user: AuthUser) {
  ensure(user, 'PRODUCTION', 'EDIT');
  await prisma.$transaction(async (tx) => {
    const existing = await tx.production.findFirst({ where: { id, deletedAt: null }, include: productionInclude });
    if (!existing) throw notFound('Production');
    editable(existing.status);
    await assertWarehouse(tx, input.warehouseId);
    const built = await productionLines(tx, input);
    await assertSourcePurchases(tx, input.sourcePurchaseIds ?? []);
    await tx.productionLine.deleteMany({ where: { productionId: id } });
    await tx.productionSource.deleteMany({ where: { productionId: id } });
    const updated = await tx.production.update({
      where: { id },
      data: {
        finishedItemId: input.finishedItemId,
        quantity: qty(input.quantity),
        slabsProduced: built.packing?.slabsProduced ?? null,
        casesProduced: built.packing?.casesProduced ?? null,
        looseSlabs: built.packing?.looseSlabs ?? null,
        netWeightKg: built.packing?.netWeightKg ?? null,
        batchNo: input.batchNo,
        producedOn: parseDate(input.producedOn),
        warehouseId: input.warehouseId,
        notes: input.notes ?? '',
        totalAmount: built.totalAmount,
        lines: { create: built.lines },
        sources: {
          create: [...new Set(input.sourcePurchaseIds ?? [])].map((purchaseId) => ({ purchaseId })),
        },
      },
      include: productionInclude,
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'UPDATE',
      entityType: 'PRODUCTION',
      entityId: id,
      summary: `Updated ${existing.docNo}`,
      before: productionSnapshot(existing),
      after: productionSnapshot(updated),
    });
  });
  return getProduction(id);
}

function productionSnapshot(doc: Prisma.ProductionGetPayload<{ include: typeof productionInclude }>) {
  return {
    status: doc.status,
    finishedItemId: doc.finishedItemId,
    sku: doc.finishedItem.sku,
    quantity: qty(doc.quantity),
    slabsProduced: doc.slabsProduced ? qty(doc.slabsProduced) : null,
    casesProduced: doc.casesProduced,
    looseSlabs: doc.looseSlabs ? qty(doc.looseSlabs) : null,
    netWeightKg: doc.netWeightKg ? qty(doc.netWeightKg) : null,
    batchNo: doc.batchNo,
    producedOn: formatDate(doc.producedOn),
    warehouseId: doc.warehouseId,
    totalAmount: money(doc.totalAmount),
    isReversal: doc.isReversal,
    lines: doc.lines.map((line) => ({
      itemId: line.itemId,
      sku: line.item.sku,
      quantity: qty(line.quantity),
      unitCost: money(line.unitCost),
    })),
  };
}

function productionMovements(doc: Prisma.ProductionGetPayload<{ include: typeof productionInclude }>): MovementDraft[] {
  const base = movementBase(doc, doc.producedOn, 'PRODUCTION');
  const componentMoves: MovementDraft[] = doc.lines.map((line) => ({
    itemId: line.itemId,
    warehouseId: doc.warehouseId,
    qtyIn: doc.isReversal ? qty(line.quantity) : '0.000',
    qtyOut: doc.isReversal ? '0.000' : qty(line.quantity),
    movementType: doc.isReversal ? 'PRODUCTION_REVERSAL_IN' : 'PRODUCTION_OUT',
    ...base,
  }));
  componentMoves.push({
    itemId: doc.finishedItemId,
    warehouseId: doc.warehouseId,
    qtyIn: doc.isReversal ? '0.000' : qty(doc.quantity),
    qtyOut: doc.isReversal ? qty(doc.quantity) : '0.000',
    movementType: doc.isReversal ? 'PRODUCTION_REVERSAL_OUT' : 'PRODUCTION_IN',
    ...base,
  });
  return componentMoves;
}

const productionAdapter: Adapter = {
  docType: 'PRODUCTION',
  module: 'PRODUCTION',
  label: 'Production',
  load: (id) => getProduction(id),
  loadTx: (tx, id) => tx.production.findFirst({ where: { id, deletedAt: null }, include: productionInclude }),
  patch: async (tx, id, data) => {
    await tx.production.update({ where: { id }, data });
  },
  claim: async (tx, id, from, data) =>
    (await tx.production.updateMany({ where: { id, status: from, deletedAt: null }, data })).count,
  movements: (doc) => productionMovements(doc as Prisma.ProductionGetPayload<{ include: typeof productionInclude }>),
  summary: (doc) => {
    const row = doc as Prisma.ProductionGetPayload<{ include: typeof productionInclude }>;
    return `${row.finishedItem.name}, batch ${row.batchNo}, qty ${qty(row.quantity)}`;
  },
  amount: (doc) => money((doc as unknown as { totalAmount: Prisma.Decimal }).totalAmount),
  snapshot: (doc) => productionSnapshot(doc as Prisma.ProductionGetPayload<{ include: typeof productionInclude }>),
  markReversed: async (tx, id) => {
    await tx.production.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'REVERSED' } });
  },
};

export const submitProduction = (id: string, user: AuthUser) => submitDoc(productionAdapter, id, user);
export const approveProduction = (id: string, user: AuthUser, remarks?: string | null) =>
  approveDoc(productionAdapter, id, user, remarks);
export const rejectProduction = (id: string, user: AuthUser, remarks: string) =>
  rejectDoc(productionAdapter, id, user, remarks);
export const reopenProduction = (id: string, user: AuthUser) => reopenDoc(productionAdapter, id, user);
export const deleteProduction = (id: string, user: AuthUser) => deleteDraft(productionAdapter, id, user);

export async function reverseProduction(id: string, user: AuthUser) {
  ensure(user, 'PRODUCTION', 'CREATE');
  const doc = await prisma.production.findFirst({ where: { id, deletedAt: null }, include: productionInclude });
  if (!doc) throw notFound('Production');
  if (doc.status !== 'POSTED') throw conflict('Only posted production can be reversed.');
  if (doc.isReversal) throw conflict('Use a stock adjustment to correct a reversal.');
  await assertNoOpenReversal('production', id, doc.docNo);
  const createdId = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'PRD');
    const created = await tx.production.create({
      data: {
        docNo,
        finishedItemId: doc.finishedItemId,
        quantity: doc.quantity,
        batchNo: `${doc.batchNo}-R`.slice(0, 60),
        producedOn: parseDate(businessToday()),
        warehouseId: doc.warehouseId,
        notes: `Reversal of ${doc.docNo}. ${doc.notes}`.slice(0, 2000),
        totalAmount: doc.totalAmount,
        isReversal: true,
        reversalOfId: doc.id,
        createdById: user.id,
        lines: {
          create: doc.lines.map((line, index) => ({
            itemId: line.itemId,
            quantity: line.quantity,
            unitCost: line.unitCost,
            sortOrder: index,
          })),
        },
      },
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'REVERSE',
      entityType: 'PRODUCTION',
      entityId: doc.id,
      summary: `Started reversal ${created.docNo} for ${doc.docNo}`,
      after: { reversalId: created.id },
    });
    return created.id;
  });
  return getProduction(createdId);
}

export async function getTransfer(id: string) {
  const doc = await prisma.transfer.findFirst({ where: { id, deletedAt: null }, include: transferInclude });
  if (!doc) throw notFound('Transfer');
  const [row] = await withPeople([doc]);
  return row;
}

export async function listTransfers(query: DocQuery) {
  const where: Prisma.TransferWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.warehouseId
      ? { OR: [{ sourceWarehouseId: query.warehouseId }, { destinationWarehouseId: query.warehouseId }] }
      : {}),
    ...(query.from || query.to
      ? {
          transferDate: {
            ...(query.from ? { gte: parseDate(query.from) } : {}),
            ...(query.to ? { lte: parseDate(query.to) } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { docNo: { contains: query.search, mode: 'insensitive' } },
            { sourceWarehouse: { name: { contains: query.search, mode: 'insensitive' } } },
            { destinationWarehouse: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const orderBy =
    query.sort === 'docNo' ? { docNo: query.order } : query.sort === 'date' ? { transferDate: query.order } : { createdAt: query.order };
  const [total, rows] = await prisma.$transaction([
    prisma.transfer.count({ where }),
    prisma.transfer.findMany({
      where,
      include: { ...transferInclude, _count: { select: { lines: true } } },
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { total, data: await withPeople(rows) };
}

function qtyLines(lines: Array<{ itemId: string; quantity: string }>) {
  return lines.map((line, index) => ({
    itemId: line.itemId,
    quantity: qty(line.quantity),
    sortOrder: index,
  }));
}

export async function createTransfer(input: z.infer<typeof transferSchema>, user: AuthUser, seedKey?: string) {
  ensure(user, 'TRANSFERS', 'CREATE');
  if (seedKey) {
    const existing = await prisma.transfer.findUnique({ where: { seedKey } });
    if (existing && !existing.deletedAt) return getTransfer(existing.id);
  }
  const id = await prisma.$transaction(async (tx) => {
    await assertWarehouse(tx, input.sourceWarehouseId);
    await assertWarehouse(tx, input.destinationWarehouseId);
    await assertItems(tx, input.lines.map((line) => line.itemId));
    const builtLines = await caseQtyLines(tx, input.lines);
    const docNo = await nextDocNo(tx, 'TRF');
    const created = await tx.transfer.create({
      data: {
        docNo,
        seedKey,
        sourceWarehouseId: input.sourceWarehouseId,
        destinationWarehouseId: input.destinationWarehouseId,
        transferDate: parseDate(input.transferDate),
        notes: input.notes ?? '',
        createdById: user.id,
        lines: { create: builtLines },
      },
      include: transferInclude,
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'CREATE',
      entityType: 'TRANSFER',
      entityId: created.id,
      summary: `Created ${created.docNo}`,
      after: transferSnapshot(created),
    });
    return created.id;
  });
  return getTransfer(id);
}

export async function updateTransfer(id: string, input: z.infer<typeof transferSchema>, user: AuthUser) {
  ensure(user, 'TRANSFERS', 'EDIT');
  await prisma.$transaction(async (tx) => {
    const existing = await tx.transfer.findFirst({ where: { id, deletedAt: null }, include: transferInclude });
    if (!existing) throw notFound('Transfer');
    editable(existing.status);
    await assertWarehouse(tx, input.sourceWarehouseId);
    await assertWarehouse(tx, input.destinationWarehouseId);
    await assertItems(tx, input.lines.map((line) => line.itemId));
    const builtLines = await caseQtyLines(tx, input.lines);
    await tx.transferLine.deleteMany({ where: { transferId: id } });
    const updated = await tx.transfer.update({
      where: { id },
      data: {
        sourceWarehouseId: input.sourceWarehouseId,
        destinationWarehouseId: input.destinationWarehouseId,
        transferDate: parseDate(input.transferDate),
        notes: input.notes ?? '',
        lines: { create: builtLines },
      },
      include: transferInclude,
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'UPDATE',
      entityType: 'TRANSFER',
      entityId: id,
      summary: `Updated ${existing.docNo}`,
      before: transferSnapshot(existing),
      after: transferSnapshot(updated),
    });
  });
  return getTransfer(id);
}

function transferSnapshot(doc: Prisma.TransferGetPayload<{ include: typeof transferInclude }>) {
  return {
    status: doc.status,
    sourceWarehouseId: doc.sourceWarehouseId,
    destinationWarehouseId: doc.destinationWarehouseId,
    transferDate: formatDate(doc.transferDate),
    notes: doc.notes,
    isReversal: doc.isReversal,
    lines: doc.lines.map((line) => ({ itemId: line.itemId, sku: line.item.sku, quantity: qty(line.quantity), cases: line.cases ? qty(line.cases) : null, looseSlabs: line.looseSlabs ? qty(line.looseSlabs) : null })),
  };
}

function transferMovements(doc: Prisma.TransferGetPayload<{ include: typeof transferInclude }>): MovementDraft[] {
  const source = doc.isReversal ? doc.destinationWarehouseId : doc.sourceWarehouseId;
  const destination = doc.isReversal ? doc.sourceWarehouseId : doc.destinationWarehouseId;
  const base = movementBase(doc, doc.transferDate, 'TRANSFER');
  return doc.lines.flatMap((line) => [
    {
      itemId: line.itemId,
      warehouseId: source,
      qtyIn: '0.000',
      qtyOut: qty(line.quantity),
      movementType: doc.isReversal ? 'TRANSFER_REVERSAL_OUT' as const : 'TRANSFER_OUT' as const,
      ...base,
    },
    {
      itemId: line.itemId,
      warehouseId: destination,
      qtyIn: qty(line.quantity),
      qtyOut: '0.000',
      movementType: doc.isReversal ? 'TRANSFER_REVERSAL_IN' as const : 'TRANSFER_IN' as const,
      ...base,
    },
  ]);
}

const transferAdapter: Adapter = {
  docType: 'TRANSFER',
  module: 'TRANSFERS',
  label: 'Transfer',
  load: (id) => getTransfer(id),
  loadTx: (tx, id) => tx.transfer.findFirst({ where: { id, deletedAt: null }, include: transferInclude }),
  patch: async (tx, id, data) => {
    await tx.transfer.update({ where: { id }, data });
  },
  claim: async (tx, id, from, data) =>
    (await tx.transfer.updateMany({ where: { id, status: from, deletedAt: null }, data })).count,
  movements: (doc) => transferMovements(doc as Prisma.TransferGetPayload<{ include: typeof transferInclude }>),
  summary: (doc) => {
    const row = doc as Prisma.TransferGetPayload<{ include: typeof transferInclude }>;
    return `${row.sourceWarehouse.code} to ${row.destinationWarehouse.code}`;
  },
  amount: () => '0.00',
  snapshot: (doc) => transferSnapshot(doc as Prisma.TransferGetPayload<{ include: typeof transferInclude }>),
  markReversed: async (tx, id) => {
    await tx.transfer.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'REVERSED' } });
  },
};

export const submitTransfer = (id: string, user: AuthUser) => submitDoc(transferAdapter, id, user);
export const approveTransfer = (id: string, user: AuthUser, remarks?: string | null) =>
  approveDoc(transferAdapter, id, user, remarks);
export const rejectTransfer = (id: string, user: AuthUser, remarks: string) => rejectDoc(transferAdapter, id, user, remarks);
export const reopenTransfer = (id: string, user: AuthUser) => reopenDoc(transferAdapter, id, user);
export const deleteTransfer = (id: string, user: AuthUser) => deleteDraft(transferAdapter, id, user);

export async function reverseTransfer(id: string, user: AuthUser) {
  ensure(user, 'TRANSFERS', 'CREATE');
  const doc = await prisma.transfer.findFirst({ where: { id, deletedAt: null }, include: transferInclude });
  if (!doc) throw notFound('Transfer');
  if (doc.status !== 'POSTED') throw conflict('Only posted transfers can be reversed.');
  if (doc.isReversal) throw conflict('Use a stock adjustment to correct a reversal.');
  await assertNoOpenReversal('transfer', id, doc.docNo);
  const createdId = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'TRF');
    const created = await tx.transfer.create({
      data: {
        docNo,
        sourceWarehouseId: doc.sourceWarehouseId,
        destinationWarehouseId: doc.destinationWarehouseId,
        transferDate: parseDate(businessToday()),
        notes: `Reversal of ${doc.docNo}. ${doc.notes}`.slice(0, 2000),
        isReversal: true,
        reversalOfId: doc.id,
        createdById: user.id,
        lines: { create: doc.lines.map((line, index) => ({ itemId: line.itemId, quantity: line.quantity, cases: line.cases, looseSlabs: line.looseSlabs, sortOrder: index })) },
      },
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'REVERSE',
      entityType: 'TRANSFER',
      entityId: doc.id,
      summary: `Started reversal ${created.docNo} for ${doc.docNo}`,
    });
    return created.id;
  });
  return getTransfer(createdId);
}

export async function getShipment(id: string) {
  const doc = await prisma.shipment.findFirst({ where: { id, deletedAt: null }, include: shipmentInclude });
  if (!doc) throw notFound('Shipment');
  const [row] = await withPeople([doc]);
  return row;
}

export async function listShipments(query: DocQuery) {
  const where: Prisma.ShipmentWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.from || query.to
      ? {
          shipmentDate: {
            ...(query.from ? { gte: parseDate(query.from) } : {}),
            ...(query.to ? { lte: parseDate(query.to) } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { docNo: { contains: query.search, mode: 'insensitive' } },
            { vehicleNo: { contains: query.search, mode: 'insensitive' } },
            { customer: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const orderBy =
    query.sort === 'docNo' ? { docNo: query.order } : query.sort === 'date' ? { shipmentDate: query.order } : { createdAt: query.order };
  const [total, rows] = await prisma.$transaction([
    prisma.shipment.count({ where }),
    prisma.shipment.findMany({
      where,
      include: { ...shipmentInclude, _count: { select: { lines: true } } },
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { total, data: await withPeople(rows) };
}

export async function createShipment(input: z.infer<typeof shipmentSchema>, user: AuthUser, seedKey?: string) {
  ensure(user, 'SHIPMENTS', 'CREATE');
  if (seedKey) {
    const existing = await prisma.shipment.findUnique({ where: { seedKey } });
    if (existing && !existing.deletedAt) return getShipment(existing.id);
  }
  const id = await prisma.$transaction(async (tx) => {
    await assertCustomer(tx, input.customerId);
    await assertWarehouse(tx, input.warehouseId);
    await assertItems(tx, input.lines.map((line) => line.itemId));
    await assertSourceProductions(tx, input.sourceProductionIds ?? []);
    const lines = await casePriceLines(tx, input.lines);
    const docNo = await nextDocNo(tx, 'SHP');
    const created = await tx.shipment.create({
      data: {
        docNo,
        seedKey,
        customerId: input.customerId,
        shipmentDate: parseDate(input.shipmentDate),
        warehouseId: input.warehouseId,
        vehicleNo: input.vehicleNo ?? '',
        notes: input.notes ?? '',
        totalAmount: sumMoney(lines.map((line) => line.lineTotal)),
        createdById: user.id,
        lines: { create: lines },
        sources: {
          create: [...new Set(input.sourceProductionIds ?? [])].map((productionId) => ({ productionId })),
        },
      },
      include: shipmentInclude,
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'CREATE',
      entityType: 'SHIPMENT',
      entityId: created.id,
      summary: `Created ${created.docNo}`,
      after: shipmentSnapshot(created),
    });
    return created.id;
  });
  return getShipment(id);
}

export async function updateShipment(id: string, input: z.infer<typeof shipmentSchema>, user: AuthUser) {
  ensure(user, 'SHIPMENTS', 'EDIT');
  await prisma.$transaction(async (tx) => {
    const existing = await tx.shipment.findFirst({ where: { id, deletedAt: null }, include: shipmentInclude });
    if (!existing) throw notFound('Shipment');
    editable(existing.status);
    await assertCustomer(tx, input.customerId);
    await assertWarehouse(tx, input.warehouseId);
    await assertItems(tx, input.lines.map((line) => line.itemId));
    await assertSourceProductions(tx, input.sourceProductionIds ?? []);
    const lines = await casePriceLines(tx, input.lines);
    await tx.shipmentLine.deleteMany({ where: { shipmentId: id } });
    await tx.shipmentSource.deleteMany({ where: { shipmentId: id } });
    const updated = await tx.shipment.update({
      where: { id },
      data: {
        customerId: input.customerId,
        shipmentDate: parseDate(input.shipmentDate),
        warehouseId: input.warehouseId,
        vehicleNo: input.vehicleNo ?? '',
        notes: input.notes ?? '',
        totalAmount: sumMoney(lines.map((line) => line.lineTotal)),
        lines: { create: lines },
        sources: {
          create: [...new Set(input.sourceProductionIds ?? [])].map((productionId) => ({ productionId })),
        },
      },
      include: shipmentInclude,
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'UPDATE',
      entityType: 'SHIPMENT',
      entityId: id,
      summary: `Updated ${existing.docNo}`,
      before: shipmentSnapshot(existing),
      after: shipmentSnapshot(updated),
    });
  });
  return getShipment(id);
}

function shipmentSnapshot(doc: Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>) {
  return {
    status: doc.status,
    customerId: doc.customerId,
    shipmentDate: formatDate(doc.shipmentDate),
    warehouseId: doc.warehouseId,
    vehicleNo: doc.vehicleNo,
    totalAmount: money(doc.totalAmount),
    isReversal: doc.isReversal,
    lines: doc.lines.map((line) => ({
      itemId: line.itemId,
      sku: line.item.sku,
      quantity: qty(line.quantity),
      cases: line.cases ? qty(line.cases) : null,
      looseSlabs: line.looseSlabs ? qty(line.looseSlabs) : null,
      netWeightKg: line.netWeightKg ? qty(line.netWeightKg) : null,
      unitPrice: money(line.unitPrice),
      lineTotal: money(line.lineTotal),
    })),
  };
}

function shipmentMovements(doc: Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>): MovementDraft[] {
  return doc.lines.map((line) => ({
    itemId: line.itemId,
    warehouseId: doc.warehouseId,
    qtyIn: doc.isReversal ? qty(line.quantity) : '0.000',
    qtyOut: doc.isReversal ? '0.000' : qty(line.quantity),
    movementType: doc.isReversal ? 'SHIPMENT_REVERSAL_IN' : 'SHIPMENT_OUT',
    ...movementBase(doc, doc.shipmentDate, 'SHIPMENT'),
  }));
}

const shipmentAdapter: Adapter = {
  docType: 'SHIPMENT',
  module: 'SHIPMENTS',
  label: 'Shipment',
  load: (id) => getShipment(id),
  loadTx: (tx, id) => tx.shipment.findFirst({ where: { id, deletedAt: null }, include: shipmentInclude }),
  patch: async (tx, id, data) => {
    await tx.shipment.update({ where: { id }, data });
  },
  claim: async (tx, id, from, data) =>
    (await tx.shipment.updateMany({ where: { id, status: from, deletedAt: null }, data })).count,
  movements: (doc) => shipmentMovements(doc as Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>),
  summary: (doc) => {
    const row = doc as Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>;
    return `${row.customer.name}, ${money(row.totalAmount)} INR`;
  },
  amount: (doc) => money((doc as unknown as { totalAmount: Prisma.Decimal }).totalAmount),
  snapshot: (doc) => shipmentSnapshot(doc as Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>),
  markReversed: async (tx, id) => {
    await tx.shipment.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'REVERSED' } });
  },
};

export const submitShipment = (id: string, user: AuthUser) => submitDoc(shipmentAdapter, id, user);
export const approveShipment = (id: string, user: AuthUser, remarks?: string | null) =>
  approveDoc(shipmentAdapter, id, user, remarks);
export const rejectShipment = (id: string, user: AuthUser, remarks: string) => rejectDoc(shipmentAdapter, id, user, remarks);
export const reopenShipment = (id: string, user: AuthUser) => reopenDoc(shipmentAdapter, id, user);
export const deleteShipment = (id: string, user: AuthUser) => deleteDraft(shipmentAdapter, id, user);

export async function reverseShipment(id: string, user: AuthUser) {
  ensure(user, 'SHIPMENTS', 'CREATE');
  const doc = await prisma.shipment.findFirst({ where: { id, deletedAt: null }, include: shipmentInclude });
  if (!doc) throw notFound('Shipment');
  if (doc.status !== 'POSTED') throw conflict('Only posted shipments can be reversed.');
  if (doc.isReversal) throw conflict('Use a stock adjustment to correct a reversal.');
  await assertNoOpenReversal('shipment', id, doc.docNo);
  const createdId = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'SHP');
    const created = await tx.shipment.create({
      data: {
        docNo,
        customerId: doc.customerId,
        shipmentDate: parseDate(businessToday()),
        warehouseId: doc.warehouseId,
        vehicleNo: doc.vehicleNo,
        notes: `Reversal of ${doc.docNo}. ${doc.notes}`.slice(0, 2000),
        totalAmount: doc.totalAmount,
        isReversal: true,
        reversalOfId: doc.id,
        createdById: user.id,
        lines: {
          create: doc.lines.map((line, index) => ({
            itemId: line.itemId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
            sortOrder: index,
          })),
        },
      },
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'REVERSE',
      entityType: 'SHIPMENT',
      entityId: doc.id,
      summary: `Started reversal ${created.docNo} for ${doc.docNo}`,
    });
    return created.id;
  });
  return getShipment(createdId);
}

export async function getAdjustment(id: string) {
  const doc = await prisma.stockAdjustment.findFirst({ where: { id, deletedAt: null }, include: adjustmentInclude });
  if (!doc) throw notFound('Adjustment');
  const [row] = await withPeople([doc]);
  return row;
}

export async function listAdjustments(query: DocQuery) {
  const where: Prisma.StockAdjustmentWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.from || query.to
      ? {
          adjustmentDate: {
            ...(query.from ? { gte: parseDate(query.from) } : {}),
            ...(query.to ? { lte: parseDate(query.to) } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { docNo: { contains: query.search, mode: 'insensitive' } },
            { notes: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const orderBy =
    query.sort === 'docNo'
      ? { docNo: query.order }
      : query.sort === 'date'
        ? { adjustmentDate: query.order }
        : { createdAt: query.order };
  const [total, rows] = await prisma.$transaction([
    prisma.stockAdjustment.count({ where }),
    prisma.stockAdjustment.findMany({
      where,
      include: { ...adjustmentInclude, _count: { select: { lines: true } } },
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { total, data: await withPeople(rows) };
}

export async function createAdjustment(input: z.infer<typeof adjustmentSchema>, user: AuthUser, seedKey?: string) {
  ensure(user, 'STOCK', 'CREATE');
  if (seedKey) {
    const existing = await prisma.stockAdjustment.findUnique({ where: { seedKey } });
    if (existing && !existing.deletedAt) return getAdjustment(existing.id);
  }
  const id = await prisma.$transaction(async (tx) => {
    await assertWarehouse(tx, input.warehouseId);
    await assertItems(tx, input.lines.map((line) => line.itemId));
    const docNo = await nextDocNo(tx, 'ADJ');
    const created = await tx.stockAdjustment.create({
      data: {
        docNo,
        seedKey,
        warehouseId: input.warehouseId,
        adjustmentDate: parseDate(input.adjustmentDate),
        reason: input.reason,
        notes: input.notes ?? '',
        createdById: user.id,
        lines: {
          create: input.lines.map((line, index) => ({
            itemId: line.itemId,
            quantity: qty(line.quantity),
            direction: line.direction,
            sortOrder: index,
          })),
        },
      },
      include: adjustmentInclude,
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'CREATE',
      entityType: 'ADJUSTMENT',
      entityId: created.id,
      summary: `Created ${created.docNo}`,
      after: adjustmentSnapshot(created),
    });
    return created.id;
  });
  return getAdjustment(id);
}

export async function updateAdjustment(id: string, input: z.infer<typeof adjustmentSchema>, user: AuthUser) {
  ensure(user, 'STOCK', 'EDIT');
  await prisma.$transaction(async (tx) => {
    const existing = await tx.stockAdjustment.findFirst({ where: { id, deletedAt: null }, include: adjustmentInclude });
    if (!existing) throw notFound('Adjustment');
    editable(existing.status);
    await assertWarehouse(tx, input.warehouseId);
    await assertItems(tx, input.lines.map((line) => line.itemId));
    await tx.adjustmentLine.deleteMany({ where: { adjustmentId: id } });
    const updated = await tx.stockAdjustment.update({
      where: { id },
      data: {
        warehouseId: input.warehouseId,
        adjustmentDate: parseDate(input.adjustmentDate),
        reason: input.reason,
        notes: input.notes ?? '',
        lines: {
          create: input.lines.map((line, index) => ({
            itemId: line.itemId,
            quantity: qty(line.quantity),
            direction: line.direction,
            sortOrder: index,
          })),
        },
      },
      include: adjustmentInclude,
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ADJUSTMENT',
      entityId: id,
      summary: `Updated ${existing.docNo}`,
      before: adjustmentSnapshot(existing),
      after: adjustmentSnapshot(updated),
    });
  });
  return getAdjustment(id);
}

function adjustmentSnapshot(doc: Prisma.StockAdjustmentGetPayload<{ include: typeof adjustmentInclude }>) {
  return {
    status: doc.status,
    warehouseId: doc.warehouseId,
    adjustmentDate: formatDate(doc.adjustmentDate),
    reason: doc.reason,
    notes: doc.notes,
    isReversal: doc.isReversal,
    lines: doc.lines.map((line) => ({
      itemId: line.itemId,
      sku: line.item.sku,
      quantity: qty(line.quantity),
      direction: line.direction,
    })),
  };
}

function adjustmentMovements(doc: Prisma.StockAdjustmentGetPayload<{ include: typeof adjustmentInclude }>): MovementDraft[] {
  const base = movementBase(doc, doc.adjustmentDate, 'ADJUSTMENT');
  return doc.lines.map((line) => {
    const inbound = doc.isReversal ? line.direction === 'OUT' : line.direction === 'IN';
    return {
      itemId: line.itemId,
      warehouseId: doc.warehouseId,
      qtyIn: inbound ? qty(line.quantity) : '0.000',
      qtyOut: inbound ? '0.000' : qty(line.quantity),
      movementType: inbound
        ? doc.isReversal
          ? 'ADJUSTMENT_REVERSAL_IN'
          : 'ADJUSTMENT_IN'
        : doc.isReversal
          ? 'ADJUSTMENT_REVERSAL_OUT'
          : 'ADJUSTMENT_OUT',
      ...base,
    };
  });
}

const adjustmentAdapter: Adapter = {
  docType: 'ADJUSTMENT',
  module: 'STOCK',
  label: 'Adjustment',
  load: (id) => getAdjustment(id),
  loadTx: (tx, id) => tx.stockAdjustment.findFirst({ where: { id, deletedAt: null }, include: adjustmentInclude }),
  patch: async (tx, id, data) => {
    await tx.stockAdjustment.update({ where: { id }, data });
  },
  claim: async (tx, id, from, data) =>
    (await tx.stockAdjustment.updateMany({ where: { id, status: from, deletedAt: null }, data })).count,
  movements: (doc) => adjustmentMovements(doc as Prisma.StockAdjustmentGetPayload<{ include: typeof adjustmentInclude }>),
  summary: (doc) => {
    const row = doc as Prisma.StockAdjustmentGetPayload<{ include: typeof adjustmentInclude }>;
    return `${row.reason.replaceAll('_', ' ').toLowerCase()} at ${row.warehouse.name}`;
  },
  amount: () => '0.00',
  snapshot: (doc) => adjustmentSnapshot(doc as Prisma.StockAdjustmentGetPayload<{ include: typeof adjustmentInclude }>),
  markReversed: async (tx, id) => {
    await tx.stockAdjustment.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'REVERSED' } });
  },
};

export const submitAdjustment = (id: string, user: AuthUser) => submitDoc(adjustmentAdapter, id, user);
export const approveAdjustment = (id: string, user: AuthUser, remarks?: string | null) =>
  approveDoc(adjustmentAdapter, id, user, remarks);
export const rejectAdjustment = (id: string, user: AuthUser, remarks: string) =>
  rejectDoc(adjustmentAdapter, id, user, remarks);
export const reopenAdjustment = (id: string, user: AuthUser) => reopenDoc(adjustmentAdapter, id, user);
export const deleteAdjustment = (id: string, user: AuthUser) => deleteDraft(adjustmentAdapter, id, user);

export async function reverseAdjustment(id: string, user: AuthUser) {
  ensure(user, 'STOCK', 'CREATE');
  const doc = await prisma.stockAdjustment.findFirst({ where: { id, deletedAt: null }, include: adjustmentInclude });
  if (!doc) throw notFound('Adjustment');
  if (doc.status !== 'POSTED') throw conflict('Only posted adjustments can be reversed.');
  if (doc.isReversal) throw conflict('Post a new adjustment to correct a reversal.');
  await assertNoOpenReversal('stockAdjustment', id, doc.docNo);
  const createdId = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'ADJ');
    const created = await tx.stockAdjustment.create({
      data: {
        docNo,
        warehouseId: doc.warehouseId,
        adjustmentDate: parseDate(businessToday()),
        reason: doc.reason,
        notes: `Reversal of ${doc.docNo}. ${doc.notes}`.slice(0, 2000),
        isReversal: true,
        reversalOfId: doc.id,
        createdById: user.id,
        lines: {
          create: doc.lines.map((line, index) => ({
            itemId: line.itemId,
            quantity: line.quantity,
            direction: line.direction,
            sortOrder: index,
          })),
        },
      },
    });
    await writeAudit(tx, {
      userId: user.id,
      action: 'REVERSE',
      entityType: 'ADJUSTMENT',
      entityId: doc.id,
      summary: `Started reversal ${created.docNo} for ${doc.docNo}`,
    });
    return created.id;
  });
  return getAdjustment(createdId);
}

const adapters: Record<DocType, Adapter> = {
  PURCHASE: purchaseAdapter,
  PRODUCTION: productionAdapter,
  TRANSFER: transferAdapter,
  SHIPMENT: shipmentAdapter,
  ADJUSTMENT: adjustmentAdapter,
};

export async function listApprovals(query: {
  page: number;
  pageSize: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  docType?: DocType;
  search?: string;
}) {
  const where: Prisma.ApprovalTaskWhereInput = {
    status: query.status,
    ...(query.docType ? { docType: query.docType } : {}),
    ...(query.search
      ? {
          OR: [
            { docNo: { contains: query.search, mode: 'insensitive' } },
            { summary: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [total, data] = await prisma.$transaction([
    prisma.approvalTask.count({ where }),
    prisma.approvalTask.findMany({
      where,
      include: { submittedBy: { select: { id: true, name: true, email: true } } },
      orderBy: { submittedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { total, data };
}

export async function approveTask(taskId: string, user: AuthUser, remarks?: string | null) {
  const task = await prisma.approvalTask.findUnique({ where: { id: taskId } });
  if (!task) throw notFound('Approval');
  if (task.status !== 'PENDING') throw conflict('That approval is no longer pending.');
  return approveDoc(adapters[task.docType], task.docId, user, remarks);
}

export async function rejectTask(taskId: string, user: AuthUser, remarks: string) {
  const task = await prisma.approvalTask.findUnique({ where: { id: taskId } });
  if (!task) throw notFound('Approval');
  if (task.status !== 'PENDING') throw conflict('That approval is no longer pending.');
  return rejectDoc(adapters[task.docType], task.docId, user, remarks);
}

export const docLinks = {
  PURCHASE: '/purchases',
  PRODUCTION: '/production',
  TRANSFER: '/transfers',
  SHIPMENT: '/shipments',
  ADJUSTMENT: '/adjustments',
};

/**
 * Traceability chain: purchase -> production -> shipment.
 * Pass exactly one of purchaseId / productionId / shipmentId.
 */
export async function traceChain(query: { purchaseId?: string; productionId?: string; shipmentId?: string }) {
  if (query.purchaseId) {
    const purchase = await prisma.purchase.findFirst({
      where: { id: query.purchaseId, deletedAt: null },
      select: { id: true, docNo: true, invoiceNo: true, status: true },
    });
    if (!purchase) throw notFound('Purchase');
    const productions = await prisma.production.findMany({
      where: { deletedAt: null, sources: { some: { purchaseId: purchase.id } } },
      select: {
        id: true, docNo: true, batchNo: true, status: true,
        finishedItem: { select: { sku: true, name: true } },
      },
      orderBy: { producedOn: 'asc' },
    });
    const prodIds = productions.map((p) => p.id);
    const shipments = prodIds.length
      ? await prisma.shipment.findMany({
          where: { deletedAt: null, sources: { some: { productionId: { in: prodIds } } } },
          select: { id: true, docNo: true, status: true, customer: { select: { name: true } } },
          orderBy: { shipmentDate: 'asc' },
        })
      : [];
    return { purchase, productions, shipments };
  }
  if (query.productionId) {
    const production = await prisma.production.findFirst({
      where: { id: query.productionId, deletedAt: null },
      select: {
        id: true, docNo: true, batchNo: true, status: true,
        sources: { include: { purchase: { select: { id: true, docNo: true, invoiceNo: true } } } },
      },
    });
    if (!production) throw notFound('Production');
    const shipments = await prisma.shipment.findMany({
      where: { deletedAt: null, sources: { some: { productionId: production.id } } },
      select: { id: true, docNo: true, status: true, customer: { select: { name: true } } },
      orderBy: { shipmentDate: 'asc' },
    });
    return {
      production: { id: production.id, docNo: production.docNo, batchNo: production.batchNo, status: production.status },
      purchases: production.sources.map((s) => s.purchase),
      shipments,
    };
  }
  if (query.shipmentId) {
    const shipment = await prisma.shipment.findFirst({
      where: { id: query.shipmentId, deletedAt: null },
      select: {
        id: true, docNo: true, status: true,
        sources: {
          include: {
            production: {
              select: {
                id: true, docNo: true, batchNo: true,
                sources: { include: { purchase: { select: { id: true, docNo: true, invoiceNo: true } } } },
              },
            },
          },
        },
      },
    });
    if (!shipment) throw notFound('Shipment');
    const productions = shipment.sources.map((s) => s.production);
    const purchases = [...new Map(productions.flatMap((p) => p.sources.map((s) => s.purchase)).map((p) => [p.id, p])).values()];
    return {
      shipment: { id: shipment.id, docNo: shipment.docNo, status: shipment.status },
      productions: productions.map((p) => ({ id: p.id, docNo: p.docNo, batchNo: p.batchNo })),
      purchases,
    };
  }
  throw validation('Pass purchaseId, productionId or shipmentId.');
}
