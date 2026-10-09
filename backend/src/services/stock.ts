import { DocType, MovementType, Prisma } from '@prisma/client';
import { d, qty } from '../lib/money';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';

type Tx = Prisma.TransactionClient;

export type MovementDraft = {
  itemId: string;
  warehouseId: string;
  qtyIn: string;
  qtyOut: string;
  movementType: MovementType;
  referenceType: DocType;
  referenceId: string;
  referenceNo: string;
  movementDate: Date;
};

async function ensureBalanceRow(tx: Tx, itemId: string, warehouseId: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO stock_balances (item_id, warehouse_id, quantity, updated_at)
    VALUES (${itemId}, ${warehouseId}, 0, NOW())
    ON CONFLICT (item_id, warehouse_id) DO NOTHING
  `;
}

export async function applyMovements(tx: Tx, movements: MovementDraft[], userId: string): Promise<string[]> {
  const ordered = [...movements].sort((a, b) => {
    if (a.itemId === b.itemId) return a.warehouseId.localeCompare(b.warehouseId);
    return a.itemId.localeCompare(b.itemId);
  });

  const keys: Array<{ itemId: string; warehouseId: string }> = [];
  const seen = new Set<string>();
  for (const movement of ordered) {
    const key = `${movement.itemId}:${movement.warehouseId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push({ itemId: movement.itemId, warehouseId: movement.warehouseId });
  }

  for (const key of keys) {
    await ensureBalanceRow(tx, key.itemId, key.warehouseId);
    await tx.$queryRaw`
      SELECT quantity FROM stock_balances
      WHERE item_id = ${key.itemId} AND warehouse_id = ${key.warehouseId}
      FOR UPDATE
    `;
  }

  const touched = new Set<string>();
  for (const movement of ordered) {
    const balance = await tx.stockBalance.findUnique({
      where: { itemId_warehouseId: { itemId: movement.itemId, warehouseId: movement.warehouseId } },
    });
    const current = balance ? d(balance.quantity) : d(0);
    const next = current.plus(d(movement.qtyIn)).minus(d(movement.qtyOut));
    if (next.lessThan(0)) {
      const item = await tx.item.findUnique({
        where: { id: movement.itemId },
        include: { unit: true },
      });
      const warehouse = await tx.warehouse.findUnique({ where: { id: movement.warehouseId } });
      throw new AppError(
        'INSUFFICIENT_STOCK',
        `${item?.sku ?? 'Item'} has ${qty(current)} ${item?.unit.code ?? ''} at ${warehouse?.name ?? 'the warehouse'}. This posting needs ${qty(movement.qtyOut)}.`,
        409,
        {
          itemId: movement.itemId,
          sku: item?.sku ?? null,
          warehouseId: movement.warehouseId,
          available: qty(current),
          required: qty(movement.qtyOut),
        },
      );
    }
    await tx.stockBalance.update({
      where: { itemId_warehouseId: { itemId: movement.itemId, warehouseId: movement.warehouseId } },
      data: { quantity: qty(next) },
    });
    await tx.stockLedger.create({
      data: {
        itemId: movement.itemId,
        warehouseId: movement.warehouseId,
        movementDate: movement.movementDate,
        movementType: movement.movementType,
        referenceType: movement.referenceType,
        referenceId: movement.referenceId,
        referenceNo: movement.referenceNo,
        qtyIn: qty(movement.qtyIn),
        qtyOut: qty(movement.qtyOut),
        balanceAfter: qty(next),
        createdById: userId,
      },
    });
    touched.add(movement.itemId);
  }
  return [...touched];
}

export async function onHand(itemId: string, warehouseId: string): Promise<string> {
  const row = await prisma.stockBalance.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId } },
  });
  return row ? qty(row.quantity) : '0.000';
}

export async function onHandMap(warehouseId: string): Promise<Array<{ itemId: string; quantity: string }>> {
  const rows = await prisma.stockBalance.findMany({ where: { warehouseId } });
  return rows.map((row) => ({ itemId: row.itemId, quantity: qty(row.quantity) }));
}
