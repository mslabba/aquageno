import type { ActionName, ModuleName } from './lib/permissions';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  tokenVersion: number;
  mustChangePassword: boolean;
  isActive: boolean;
  roleId: string;
  roleName: string;
  permissions: Set<string>;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

export type Grants = Partial<Record<ModuleName, ActionName[]>>;
