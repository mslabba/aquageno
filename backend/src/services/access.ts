import { PermissionAction, PermissionModule, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { writeAudit } from '../lib/audit';
import { conflict, forbidden, notFound, validation } from '../lib/errors';
import { hashPassword } from '../lib/password';
import { ACTIONS, MODULES, grantsToSet, hasPerm, type ActionName, type ModuleName } from '../lib/permissions';
import type { AuthUser } from '../types';
import type { z } from 'zod';
import { grantsSchema, roleWriteSchema, userCreateSchema, userPatchSchema } from '../lib/validators';

const alive = { deletedAt: null };

function grantsOf(rows: Array<{ module: PermissionModule; action: PermissionAction }>): Record<string, ActionName[]> {
  const grants: Record<string, ActionName[]> = {};
  for (const module of MODULES) grants[module] = [];
  for (const row of rows) {
    grants[row.module].push(row.action);
  }
  return grants;
}

async function assertAccessRemains(userId: string, next?: { roleId?: string; isActive?: boolean }) {
  const users = await prisma.user.findMany({
    where: { deletedAt: null, isActive: true },
    include: { role: { include: { permissions: true } } },
  });
  const nextRole = next?.roleId
    ? await prisma.role.findFirst({ where: { id: next.roleId }, include: { permissions: true } })
    : null;
  const keepers = users.filter((candidate) => {
    const active = candidate.id === userId ? next?.isActive !== false : true;
    if (!active) return false;
    const permissions =
      candidate.id === userId && nextRole ? grantsToSet(nextRole.permissions) : grantsToSet(candidate.role.permissions);
    return hasPerm(permissions, 'USERS', 'EDIT') && hasPerm(permissions, 'ROLES', 'EDIT');
  });
  if (keepers.length === 0) {
    throw conflict('Keep at least one active user who can manage users and roles.');
  }
}

export async function listUsers(query: { page: number; pageSize: number; search?: string }) {
  const where: Prisma.UserWhereInput = {
    ...alive,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: { role: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    total,
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      isActive: row.isActive,
      mustChangePassword: row.mustChangePassword,
      role: row.role,
      createdAt: row.createdAt,
    })),
  };
}

export async function createUser(input: z.infer<typeof userCreateSchema>, actor: AuthUser) {
  const role = await prisma.role.findFirst({ where: { id: input.roleId, ...alive, isActive: true } });
  if (!role) throw validation('Choose an active role.');
  const row = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      roleId: input.roleId,
      mustChangePassword: input.mustChangePassword,
    },
    include: { role: { select: { id: true, name: true } } },
  });
  await writeAudit(prisma, {
    userId: actor.id,
    action: 'CREATE',
    entityType: 'USER',
    entityId: row.id,
    summary: `Added user ${row.email}`,
    after: { name: row.name, email: row.email, roleId: row.roleId },
  });
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    role: row.role,
  };
}

export async function updateUser(id: string, input: z.infer<typeof userPatchSchema>, actor: AuthUser) {
  const existing = await prisma.user.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('User');
  if (input.roleId) {
    const role = await prisma.role.findFirst({ where: { id: input.roleId, ...alive, isActive: true } });
    if (!role) throw validation('Choose an active role.');
  }
  if (input.isActive === false || input.roleId) {
    await assertAccessRemains(id, { roleId: input.roleId, isActive: input.isActive });
  }
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.roleId ? { roleId: input.roleId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.mustChangePassword !== undefined ? { mustChangePassword: input.mustChangePassword } : {}),
        ...(input.password
          ? { passwordHash: await hashPassword(input.password), tokenVersion: { increment: 1 } }
          : {}),
        ...(input.isActive === false ? { tokenVersion: { increment: 1 } } : {}),
      },
      include: { role: { select: { id: true, name: true } } },
    });
    if (input.password || input.isActive === false || input.roleId) {
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await writeAudit(tx, {
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'USER',
      entityId: id,
      summary: `Updated user ${updated.email}`,
      before: { name: existing.name, roleId: existing.roleId, isActive: existing.isActive },
      after: { name: updated.name, roleId: updated.roleId, isActive: updated.isActive, passwordReset: Boolean(input.password) },
    });
    return updated;
  });
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    role: row.role,
  };
}

export async function deleteUser(id: string, actor: AuthUser) {
  if (id === actor.id) throw conflict('You cannot remove your own user.');
  const existing = await prisma.user.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('User');
  await assertAccessRemains(id, { isActive: false });
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date(), tokenVersion: { increment: 1 } },
    });
    await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAudit(tx, {
      userId: actor.id,
      action: 'DELETE',
      entityType: 'USER',
      entityId: id,
      summary: `Removed user ${existing.email}`,
    });
  });
  return { id, mode: 'deleted' as const };
}

export async function listRoles() {
  const roles = await prisma.role.findMany({
    where: alive,
    include: { _count: { select: { users: { where: alive } } }, permissions: true },
    orderBy: { name: 'asc' },
  });
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isActive: role.isActive,
    userCount: role._count.users,
    grants: grantsOf(role.permissions),
  }));
}

export async function getRole(id: string) {
  const role = await prisma.role.findFirst({
    where: { id, ...alive },
    include: { permissions: true, _count: { select: { users: { where: alive } } } },
  });
  if (!role) throw notFound('Role');
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isActive: role.isActive,
    userCount: role._count.users,
    grants: grantsOf(role.permissions),
    modules: MODULES,
    actions: ACTIONS,
  };
}

export async function createRole(input: z.infer<typeof roleWriteSchema>, actor: AuthUser) {
  const role = await prisma.role.create({ data: { name: input.name, description: input.description ?? '' } });
  await writeAudit(prisma, {
    userId: actor.id,
    action: 'CREATE',
    entityType: 'ROLE',
    entityId: role.id,
    summary: `Added role ${role.name}`,
    after: { name: role.name, description: role.description },
  });
  return getRole(role.id);
}

export async function updateRole(id: string, input: z.infer<typeof roleWriteSchema>, actor: AuthUser) {
  const existing = await prisma.role.findFirst({ where: { id, ...alive } });
  if (!existing) throw notFound('Role');
  if (existing.isSystem && input.name !== existing.name) {
    throw conflict('The system administrator role keeps its name.');
  }
  const role = await prisma.role.update({
    where: { id },
    data: { name: input.name, description: input.description ?? '' },
  });
  await writeAudit(prisma, {
    userId: actor.id,
    action: 'UPDATE',
    entityType: 'ROLE',
    entityId: id,
    summary: `Updated role ${role.name}`,
    before: { name: existing.name, description: existing.description },
    after: { name: role.name, description: role.description },
  });
  return getRole(id);
}

export async function replaceGrants(id: string, input: z.infer<typeof grantsSchema>, actor: AuthUser) {
  const role = await prisma.role.findFirst({ where: { id, ...alive }, include: { permissions: true } });
  if (!role) throw notFound('Role');
  const grants: Partial<Record<ModuleName, ActionName[]>> = { ...input.grants };
  if (role.isSystem) {
    grants.USERS = [...ACTIONS];
    grants.ROLES = [...ACTIONS];
  }
  const rows: Array<{ roleId: string; module: ModuleName; action: ActionName }> = [];
  for (const module of MODULES) {
    const actions = new Set(grants[module] ?? []);
    for (const action of ACTIONS) {
      if (actions.has(action)) rows.push({ roleId: id, module, action });
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.permission.deleteMany({ where: { roleId: id } });
    if (rows.length) await tx.permission.createMany({ data: rows });
    await writeAudit(tx, {
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'ROLE',
      entityId: id,
      summary: `Updated permissions for ${role.name}`,
      before: grantsOf(role.permissions),
      after: grantsOf(rows.map((row) => ({ module: row.module, action: row.action }))),
    });
  });
  return getRole(id);
}

export async function deleteRole(id: string, actor: AuthUser) {
  const role = await prisma.role.findFirst({
    where: { id, ...alive },
    include: { _count: { select: { users: { where: alive } } } },
  });
  if (!role) throw notFound('Role');
  if (role.isSystem) throw forbidden('The system administrator role cannot be removed.');
  if (role._count.users > 0) throw conflict('Reassign users before removing this role.');
  await prisma.role.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });
  await writeAudit(prisma, {
    userId: actor.id,
    action: 'DELETE',
    entityType: 'ROLE',
    entityId: id,
    summary: `Removed role ${role.name}`,
  });
  return { id, mode: 'deleted' as const };
}

export async function listAudit(query: {
  page: number;
  pageSize: number;
  search?: string;
  from?: string;
  to?: string;
  entityType?: string;
  userId?: string;
}) {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...(query.search ? { summary: { contains: query.search, mode: 'insensitive' } } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  const ids = [...new Set(rows.map((row) => row.userId).filter((id): id is string => Boolean(id)))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(users.map((user) => [user.id, user.name]));
  return {
    total,
    data: rows.map((row) => ({ ...row, userName: row.userId ? names.get(row.userId) ?? 'Unknown user' : 'System' })),
  };
}

export async function listNotifications(userId: string, query: { page: number; pageSize: number; unread?: boolean }) {
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(query.unread ? { readAt: null } : {}),
  };
  const [total, data] = await prisma.$transaction([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { total, data };
}

export async function unreadCount(userId: string) {
  const count = await prisma.notification.count({ where: { userId, readAt: null } });
  return { count };
}

export async function markRead(userId: string, id: string) {
  const row = await prisma.notification.findFirst({ where: { id, userId } });
  if (!row) throw notFound('Notification');
  return prisma.notification.update({ where: { id }, data: { readAt: row.readAt ?? new Date() } });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return { ok: true };
}
