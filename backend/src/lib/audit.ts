import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from './prisma';

type Tx = Prisma.TransactionClient;

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  const encoded = JSON.stringify(value, (_key, inner) => {
    if (
      inner &&
      typeof inner === 'object' &&
      (inner as { constructor?: { name?: string } }).constructor?.name === 'Decimal'
    ) {
      return (inner as { toString(): string }).toString();
    }
    return inner;
  });
  return JSON.parse(encoded) as Prisma.InputJsonValue;
}

export async function writeAudit(
  tx: Tx | typeof prisma,
  input: {
    userId: string | null;
    action: AuditAction;
    entityType: string;
    entityId: string;
    summary: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      before: jsonValue(input.before),
      after: jsonValue(input.after),
    },
  });
}
