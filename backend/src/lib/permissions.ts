import { PermissionAction, PermissionModule } from '@prisma/client';

export const MODULES = [
  'DASHBOARD',
  'PURCHASES',
  'PRODUCTION',
  'STOCK',
  'TRANSFERS',
  'SHIPMENTS',
  'REPORTS',
  'MASTER_DATA',
  'USERS',
  'ROLES',
  'APPROVALS',
] as const satisfies readonly PermissionModule[];

export const ACTIONS = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE'] as const satisfies readonly PermissionAction[];

export type ModuleName = (typeof MODULES)[number];
export type ActionName = (typeof ACTIONS)[number];

export function permKey(module: ModuleName, action: ActionName): string {
  return `${module}:${action}`;
}

export function hasPerm(permissions: Set<string>, module: ModuleName, action: ActionName): boolean {
  return permissions.has(permKey(module, action));
}

export function allGrants(): Record<ModuleName, ActionName[]> {
  const grants = {} as Record<ModuleName, ActionName[]>;
  for (const module of MODULES) grants[module] = [...ACTIONS];
  return grants;
}

export function grantsToSet(grants: { module: PermissionModule; action: PermissionAction }[]): Set<string> {
  return new Set(grants.map((grant) => `${grant.module}:${grant.action}`));
}

export const MODULE_LABELS: Record<ModuleName, string> = {
  DASHBOARD: 'Dashboard',
  PURCHASES: 'Purchases',
  PRODUCTION: 'Production',
  STOCK: 'Stock',
  TRANSFERS: 'Transfers',
  SHIPMENTS: 'Shipments',
  REPORTS: 'Reports',
  MASTER_DATA: 'Master Data',
  USERS: 'Users',
  ROLES: 'Roles',
  APPROVALS: 'Approvals',
};
