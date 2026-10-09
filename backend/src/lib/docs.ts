import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

type Tx = Prisma.TransactionClient;

export async function nextDocNo(tx: Tx, prefix: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ next: number }>>`
    INSERT INTO document_sequences (prefix, next)
    VALUES (${prefix}, 1)
    ON CONFLICT (prefix)
    DO UPDATE SET next = document_sequences.next + 1
    RETURNING next
  `;
  return `${prefix}-${String(rows[0].next).padStart(5, '0')}`;
}

export async function nameMap(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map<string, { id: string; name: string; email: string }>();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((user) => [user.id, user]));
}

export function attachPeople<T extends {
  createdById: string;
  submittedById?: string | null;
  approvedById?: string | null;
  rejectedById?: string | null;
}>(
  row: T,
  people: Map<string, { id: string; name: string; email: string }>,
) {
  return {
    ...row,
    createdBy: people.get(row.createdById) ?? null,
    submittedBy: row.submittedById ? people.get(row.submittedById) ?? null : null,
    approvedBy: row.approvedById ? people.get(row.approvedById) ?? null : null,
    rejectedBy: row.rejectedById ? people.get(row.rejectedById) ?? null : null,
  };
}
