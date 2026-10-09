import { NotificationType, PermissionModule, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { mailer } from '../lib/mailer';
import { d } from '../lib/money';
import { logger } from '../lib/logger';

type Tx = Prisma.TransactionClient;

async function usersWith(tx: Tx | typeof prisma, module: PermissionModule, action: 'APPROVE' | 'VIEW') {
  return tx.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      role: {
        isActive: true,
        deletedAt: null,
        permissions: { some: { module, action } },
      },
    },
    select: { id: true, email: true, name: true },
  });
}

export async function queueApprovalRequest(
  tx: Tx,
  input: {
    module: PermissionModule;
    docNo: string;
    docTypeLabel: string;
    summary: string;
    entityType: string;
    entityId: string;
    submitterId: string;
  },
): Promise<Array<{ email: string; name: string }>> {
  const approvers = await usersWith(tx, input.module, 'APPROVE');
  const recipients = approvers.filter((user) => user.id !== input.submitterId);
  const title = `${input.docTypeLabel} ${input.docNo} is waiting for approval`;
  const body = input.summary;
  for (const user of recipients) {
    await tx.notification.create({
      data: {
        userId: user.id,
        type: NotificationType.APPROVAL_REQUESTED,
        title,
        body,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });
  }
  return recipients.map((user) => ({ email: user.email, name: user.name }));
}

export function sendApprovalEmails(
  recipients: Array<{ email: string; name: string }>,
  title: string,
  body: string,
): void {
  for (const recipient of recipients) {
    mailer.send({ to: recipient.email, subject: title, text: `${body}\n\nOpen Aquageno to review it.` }).catch((err) => {
      logger.error({ err }, 'mailer failed');
    });
  }
}

export async function notifyDecision(input: {
  userId: string;
  email: string;
  approved: boolean;
  docNo: string;
  docTypeLabel: string;
  remarks: string | null;
  entityType: string;
  entityId: string;
}): Promise<void> {
  const title = input.approved
    ? `${input.docTypeLabel} ${input.docNo} was approved`
    : `${input.docTypeLabel} ${input.docNo} was rejected`;
  const body = input.remarks ? input.remarks : title;
  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.approved ? NotificationType.APPROVAL_COMPLETED : NotificationType.APPROVAL_REJECTED,
      title,
      body,
      entityType: input.entityType,
      entityId: input.entityId,
    },
  });
  sendApprovalEmails([{ email: input.email, name: '' }], title, body);
}

export async function notifyLowStock(tx: Tx, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  const items = await tx.item.findMany({
    where: { id: { in: itemIds }, deletedAt: null, isActive: true },
    include: { unit: true, balances: true },
  });
  const watchers = await usersWith(tx, 'STOCK', 'VIEW');
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const item of items) {
    if (d(item.reorderLevel).lessThanOrEqualTo(0)) continue;
    const onHand = item.balances.reduce((sum, row) => sum.plus(d(row.quantity)), d(0));
    if (onHand.greaterThan(item.reorderLevel)) continue;
    const title = `${item.sku} is at or below its reorder level`;
    const body = `${item.name} has ${onHand.toFixed(3)} ${item.unit.code} on hand. Reorder level is ${d(item.reorderLevel).toFixed(3)} ${item.unit.code}.`;
    for (const user of watchers) {
      const recent = await tx.notification.findFirst({
        where: {
          userId: user.id,
          type: 'LOW_STOCK',
          entityId: item.id,
          readAt: null,
          createdAt: { gte: since },
        },
      });
      if (recent) continue;
      await tx.notification.create({
        data: {
          userId: user.id,
          type: 'LOW_STOCK',
          title,
          body,
          entityType: 'ITEM',
          entityId: item.id,
        },
      });
    }
  }
}
