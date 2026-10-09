import { Router } from 'express';
import type { Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { pageMeta, sendData } from '../lib/http';
import { toCsv } from '../lib/csv';
import { wrap } from '../lib/async';
import { requirePerm, requireAll } from '../middleware/permission';
import { currentUser } from '../middleware/auth';
import { queryOf, validateBody, validateQuery } from '../middleware/validate';
import type { ActionName, ModuleName } from '../lib/permissions';
import {
  adjustmentSchema,
  approvalQuerySchema,
  approveSchema,
  bomSchema,
  categorySchema,
  docListSchema,
  masterListSchema,
  partySchema,
  productionSchema,
  purchaseSchema,
  rejectSchema,
  reportQuerySchema,
  roleWriteSchema,
  grantsSchema,
  shipmentSchema,
  stockQuerySchema,
  transferSchema,
  unitSchema,
  userCreateSchema,
  userPatchSchema,
  warehouseSchema,
  itemSchema,
  pagingSchema,
} from '../lib/validators';
import * as catalog from '../services/catalog';
import * as access from '../services/access';
import * as docs from '../services/documents';
import * as insights from '../services/insights';
import { onHandMap } from '../services/stock';

function paged(res: Response, page: number, pageSize: number, total: number, data: unknown) {
  sendData(res, data, pageMeta(page, pageSize, total));
}

function masterRouter(
  module: ModuleName,
  handlers: {
    list: (query: {
      page: number;
      pageSize: number;
      search?: string;
      state: 'active' | 'inactive' | 'all';
      itemType?: 'RAW_MATERIAL' | 'PACKING_MATERIAL' | 'FINISHED_GOOD';
      finishedItemId?: string;
    }) => Promise<{ data: unknown; total: number }>;
    create: (body: any, user: ReturnType<typeof currentUser>) => Promise<unknown>;
    update: (id: string, body: any, user: ReturnType<typeof currentUser>) => Promise<unknown>;
    remove: (id: string, user: ReturnType<typeof currentUser>) => Promise<unknown>;
    schema: ZodTypeAny;
    get?: (id: string) => Promise<unknown>;
  },
) {
  const router = Router();
  router.get(
    '/',
    requirePerm(module, 'VIEW'),
    validateQuery(masterListSchema),
    wrap(async (req, res) => {
      const query = queryOf<Parameters<typeof handlers.list>[0]>(req);
      const result = await handlers.list(query);
      paged(res, query.page, query.pageSize, result.total, result.data);
    }),
  );
  router.post(
    '/',
    requirePerm(module, 'CREATE'),
    validateBody(handlers.schema),
    wrap(async (req, res) => {
      sendData(res, await handlers.create(req.body, currentUser(req)), null, 201);
    }),
  );
  if (handlers.get) {
    router.get(
      '/:id',
      requirePerm(module, 'VIEW'),
      wrap(async (req, res) => {
        sendData(res, await handlers.get!(req.params.id));
      }),
    );
  }
  router.patch(
    '/:id',
    requirePerm(module, 'EDIT'),
    validateBody(handlers.schema),
    wrap(async (req, res) => {
      sendData(res, await handlers.update(req.params.id, req.body, currentUser(req)));
    }),
  );
  router.delete(
    '/:id',
    requirePerm(module, 'DELETE'),
    wrap(async (req, res) => {
      sendData(res, await handlers.remove(req.params.id, currentUser(req)));
    }),
  );
  return router;
}

function documentRouter(
  module: ModuleName,
  schema: ZodTypeAny,
  handlers: {
    list: (query: ReturnType<typeof docListSchema.parse>) => Promise<{ data: unknown; total: number }>;
    get: (id: string) => Promise<unknown>;
    create: (body: any, user: ReturnType<typeof currentUser>) => Promise<unknown>;
    update: (id: string, body: any, user: ReturnType<typeof currentUser>) => Promise<unknown>;
    remove: (id: string, user: ReturnType<typeof currentUser>) => Promise<unknown>;
    submit: (id: string, user: ReturnType<typeof currentUser>) => Promise<unknown>;
    approve: (id: string, user: ReturnType<typeof currentUser>, remarks?: string | null) => Promise<unknown>;
    reject: (id: string, user: ReturnType<typeof currentUser>, remarks: string) => Promise<unknown>;
    reopen: (id: string, user: ReturnType<typeof currentUser>) => Promise<unknown>;
    reverse: (id: string, user: ReturnType<typeof currentUser>) => Promise<unknown>;
  },
) {
  const router = Router();
  const approvePerm = requireAll([
    [module, 'APPROVE'],
    ['APPROVALS', 'APPROVE'],
  ] as Array<[ModuleName, ActionName]>);
  router.get(
    '/',
    requirePerm(module, 'VIEW'),
    validateQuery(docListSchema),
    wrap(async (req, res) => {
      const query = queryOf<ReturnType<typeof docListSchema.parse>>(req);
      const result = await handlers.list(query);
      paged(res, query.page, query.pageSize, result.total, result.data);
    }),
  );
  router.post(
    '/',
    requirePerm(module, 'CREATE'),
    validateBody(schema),
    wrap(async (req, res) => {
      sendData(res, await handlers.create(req.body, currentUser(req)), null, 201);
    }),
  );
  router.get(
    '/:id',
    requirePerm(module, 'VIEW'),
    wrap(async (req, res) => {
      sendData(res, await handlers.get(req.params.id));
    }),
  );
  router.patch(
    '/:id',
    requirePerm(module, 'EDIT'),
    validateBody(schema),
    wrap(async (req, res) => {
      sendData(res, await handlers.update(req.params.id, req.body, currentUser(req)));
    }),
  );
  router.delete(
    '/:id',
    requirePerm(module, 'DELETE'),
    wrap(async (req, res) => {
      sendData(res, await handlers.remove(req.params.id, currentUser(req)));
    }),
  );
  router.post(
    '/:id/submit',
    requirePerm(module, 'CREATE'),
    wrap(async (req, res) => {
      sendData(res, await handlers.submit(req.params.id, currentUser(req)));
    }),
  );
  router.post(
    '/:id/approve',
    approvePerm,
    validateBody(approveSchema),
    wrap(async (req, res) => {
      sendData(res, await handlers.approve(req.params.id, currentUser(req), req.body.remarks));
    }),
  );
  router.post(
    '/:id/reject',
    approvePerm,
    validateBody(rejectSchema),
    wrap(async (req, res) => {
      sendData(res, await handlers.reject(req.params.id, currentUser(req), req.body.remarks));
    }),
  );
  router.post(
    '/:id/reopen',
    requirePerm(module, 'EDIT'),
    wrap(async (req, res) => {
      sendData(res, await handlers.reopen(req.params.id, currentUser(req)));
    }),
  );
  router.post(
    '/:id/reverse',
    requirePerm(module, 'CREATE'),
    wrap(async (req, res) => {
      sendData(res, await handlers.reverse(req.params.id, currentUser(req)), null, 201);
    }),
  );
  return router;
}

export const usersRouter = Router();
usersRouter.get(
  '/',
  requirePerm('USERS', 'VIEW'),
  validateQuery(pagingSchema),
  wrap(async (req, res) => {
    const query = queryOf<{ page: number; pageSize: number; search?: string }>(req);
    const result = await access.listUsers(query);
    paged(res, query.page, query.pageSize, result.total, result.data);
  }),
);
usersRouter.post(
  '/',
  requirePerm('USERS', 'CREATE'),
  validateBody(userCreateSchema),
  wrap(async (req, res) => {
    sendData(res, await access.createUser(req.body, currentUser(req)), null, 201);
  }),
);
usersRouter.patch(
  '/:id',
  requirePerm('USERS', 'EDIT'),
  validateBody(userPatchSchema),
  wrap(async (req, res) => {
    sendData(res, await access.updateUser(req.params.id, req.body, currentUser(req)));
  }),
);
usersRouter.delete(
  '/:id',
  requirePerm('USERS', 'DELETE'),
  wrap(async (req, res) => {
    sendData(res, await access.deleteUser(req.params.id, currentUser(req)));
  }),
);

export const rolesRouter = Router();
rolesRouter.get(
  '/',
  requirePerm('ROLES', 'VIEW'),
  wrap(async (_req, res) => {
    sendData(res, await access.listRoles());
  }),
);
rolesRouter.post(
  '/',
  requirePerm('ROLES', 'CREATE'),
  validateBody(roleWriteSchema),
  wrap(async (req, res) => {
    sendData(res, await access.createRole(req.body, currentUser(req)), null, 201);
  }),
);
rolesRouter.get(
  '/:id',
  requirePerm('ROLES', 'VIEW'),
  wrap(async (req, res) => {
    sendData(res, await access.getRole(req.params.id));
  }),
);
rolesRouter.patch(
  '/:id',
  requirePerm('ROLES', 'EDIT'),
  validateBody(roleWriteSchema),
  wrap(async (req, res) => {
    sendData(res, await access.updateRole(req.params.id, req.body, currentUser(req)));
  }),
);
rolesRouter.put(
  '/:id/permissions',
  requirePerm('ROLES', 'EDIT'),
  validateBody(grantsSchema),
  wrap(async (req, res) => {
    sendData(res, await access.replaceGrants(req.params.id, req.body, currentUser(req)));
  }),
);
rolesRouter.delete(
  '/:id',
  requirePerm('ROLES', 'DELETE'),
  wrap(async (req, res) => {
    sendData(res, await access.deleteRole(req.params.id, currentUser(req)));
  }),
);

export const unitsRouter = masterRouter('MASTER_DATA', {
  list: catalog.listUnits,
  create: catalog.createUnit,
  update: catalog.updateUnit,
  remove: catalog.deleteUnit,
  schema: unitSchema,
});
export const categoriesRouter = masterRouter('MASTER_DATA', {
  list: catalog.listCategories,
  create: catalog.createCategory,
  update: catalog.updateCategory,
  remove: catalog.deleteCategory,
  schema: categorySchema,
});
export const warehousesRouter = masterRouter('MASTER_DATA', {
  list: catalog.listWarehouses,
  create: catalog.createWarehouse,
  update: catalog.updateWarehouse,
  remove: catalog.deleteWarehouse,
  schema: warehouseSchema,
});
export const suppliersRouter = masterRouter('MASTER_DATA', {
  list: catalog.listSuppliers,
  create: catalog.createSupplier,
  update: catalog.updateSupplier,
  remove: catalog.deleteSupplier,
  schema: partySchema,
});
export const customersRouter = masterRouter('MASTER_DATA', {
  list: catalog.listCustomers,
  create: catalog.createCustomer,
  update: catalog.updateCustomer,
  remove: catalog.deleteCustomer,
  schema: partySchema,
});
export const itemsRouter = masterRouter('MASTER_DATA', {
  list: catalog.listItems,
  create: catalog.createItem,
  update: catalog.updateItem,
  remove: catalog.deleteItem,
  get: catalog.getItem,
  schema: itemSchema,
});
export const bomsRouter = masterRouter('MASTER_DATA', {
  list: catalog.listBoms,
  create: catalog.createBom,
  update: catalog.updateBom,
  remove: catalog.deleteBom,
  get: catalog.getBom,
  schema: bomSchema,
});

export const purchasesRouter = documentRouter('PURCHASES', purchaseSchema, {
  list: docs.listPurchases,
  get: docs.getPurchase,
  create: docs.createPurchase,
  update: docs.updatePurchase,
  remove: docs.deletePurchase,
  submit: docs.submitPurchase,
  approve: docs.approvePurchase,
  reject: docs.rejectPurchase,
  reopen: docs.reopenPurchase,
  reverse: docs.reversePurchase,
});
export const productionsRouter = documentRouter('PRODUCTION', productionSchema, {
  list: docs.listProductions,
  get: docs.getProduction,
  create: docs.createProduction,
  update: docs.updateProduction,
  remove: docs.deleteProduction,
  submit: docs.submitProduction,
  approve: docs.approveProduction,
  reject: docs.rejectProduction,
  reopen: docs.reopenProduction,
  reverse: docs.reverseProduction,
});
export const transfersRouter = documentRouter('TRANSFERS', transferSchema, {
  list: docs.listTransfers,
  get: docs.getTransfer,
  create: docs.createTransfer,
  update: docs.updateTransfer,
  remove: docs.deleteTransfer,
  submit: docs.submitTransfer,
  approve: docs.approveTransfer,
  reject: docs.rejectTransfer,
  reopen: docs.reopenTransfer,
  reverse: docs.reverseTransfer,
});
export const shipmentsRouter = documentRouter('SHIPMENTS', shipmentSchema, {
  list: docs.listShipments,
  get: docs.getShipment,
  create: docs.createShipment,
  update: docs.updateShipment,
  remove: docs.deleteShipment,
  submit: docs.submitShipment,
  approve: docs.approveShipment,
  reject: docs.rejectShipment,
  reopen: docs.reopenShipment,
  reverse: docs.reverseShipment,
});
export const adjustmentsRouter = documentRouter('STOCK', adjustmentSchema, {
  list: docs.listAdjustments,
  get: docs.getAdjustment,
  create: docs.createAdjustment,
  update: docs.updateAdjustment,
  remove: docs.deleteAdjustment,
  submit: docs.submitAdjustment,
  approve: docs.approveAdjustment,
  reject: docs.rejectAdjustment,
  reopen: docs.reopenAdjustment,
  reverse: docs.reverseAdjustment,
});

export const stockRouter = Router();
stockRouter.get(
  '/balances',
  requirePerm('STOCK', 'VIEW'),
  validateQuery(stockQuerySchema),
  wrap(async (req, res) => {
    const query = queryOf<ReturnType<typeof stockQuerySchema.parse>>(req);
    const result = await insights.stockBalances(query);
    paged(res, query.page, query.pageSize, result.total, result.data);
  }),
);
stockRouter.get(
  '/ledger',
  requirePerm('STOCK', 'VIEW'),
  validateQuery(reportQuerySchema),
  wrap(async (req, res) => {
    const query = queryOf<ReturnType<typeof reportQuerySchema.parse>>(req);
    const table = await insights.ledgerReport(query, query.format === 'csv');
    if (query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="stock-ledger.csv"');
      res.send(toCsv(table.columns, table.rows));
      return;
    }
    sendData(
      res,
      { columns: table.columns, rows: table.rows, kpis: table.kpis, truncated: Boolean(table.truncated) },
      pageMeta(query.page, query.pageSize, table.total),
    );
  }),
);
stockRouter.get(
  '/on-hand',
  requirePerm('STOCK', 'VIEW'),
  wrap(async (req, res) => {
    const warehouseId = String(req.query.warehouseId ?? '');
    if (!warehouseId) {
      sendData(res, []);
      return;
    }
    sendData(res, await onHandMap(warehouseId));
  }),
);

export const approvalsRouter = Router();
approvalsRouter.get(
  '/',
  requirePerm('APPROVALS', 'VIEW'),
  validateQuery(approvalQuerySchema),
  wrap(async (req, res) => {
    const query = queryOf<ReturnType<typeof approvalQuerySchema.parse>>(req);
    const result = await docs.listApprovals(query);
    paged(res, query.page, query.pageSize, result.total, result.data);
  }),
);
approvalsRouter.post(
  '/:id/approve',
  requirePerm('APPROVALS', 'APPROVE'),
  validateBody(approveSchema),
  wrap(async (req, res) => {
    sendData(res, await docs.approveTask(req.params.id, currentUser(req), req.body.remarks));
  }),
);
approvalsRouter.post(
  '/:id/reject',
  requirePerm('APPROVALS', 'APPROVE'),
  validateBody(rejectSchema),
  wrap(async (req, res) => {
    sendData(res, await docs.rejectTask(req.params.id, currentUser(req), req.body.remarks));
  }),
);

export const notificationsRouter = Router();
notificationsRouter.get(
  '/',
  wrap(async (req, res) => {
    const query = pagingSchema.parse(req.query);
    const unread = req.query.unread === 'true';
    const result = await access.listNotifications(currentUser(req).id, { ...query, unread });
    paged(res, query.page, query.pageSize, result.total, result.data);
  }),
);
notificationsRouter.get(
  '/unread-count',
  wrap(async (req, res) => {
    sendData(res, await access.unreadCount(currentUser(req).id));
  }),
);
notificationsRouter.post(
  '/read-all',
  wrap(async (req, res) => {
    sendData(res, await access.markAllRead(currentUser(req).id));
  }),
);
notificationsRouter.post(
  '/:id/read',
  wrap(async (req, res) => {
    sendData(res, await access.markRead(currentUser(req).id, req.params.id));
  }),
);

export const auditRouter = Router();
auditRouter.get(
  '/',
  requirePerm('DASHBOARD', 'VIEW'),
  validateQuery(pagingSchema.extend({
    entityType: pagingSchema.shape.search,
    userId: pagingSchema.shape.search,
  })),
  wrap(async (req, res) => {
    const query = queryOf<{
      page: number;
      pageSize: number;
      search?: string;
      from?: string;
      to?: string;
      entityType?: string;
      userId?: string;
    }>(req);
    const result = await access.listAudit({
      ...query,
      entityType: typeof req.query.entityType === 'string' ? req.query.entityType : undefined,
      userId: typeof req.query.userId === 'string' ? req.query.userId : undefined,
    });
    paged(res, query.page, query.pageSize, result.total, result.data);
  }),
);

export const dashboardRouter = Router();
dashboardRouter.get(
  '/',
  requirePerm('DASHBOARD', 'VIEW'),
  wrap(async (_req, res) => {
    sendData(res, await insights.dashboard());
  }),
);

export const referenceRouter = Router();
referenceRouter.get(
  '/',
  wrap(async (_req, res) => {
    sendData(res, await catalog.referenceData());
  }),
);

function reportRoute(
  module: ModuleName,
  filename: string,
  run: (query: ReturnType<typeof reportQuerySchema.parse>, exportAll: boolean) => Promise<insights.Tabular>,
) {
  return [
    requirePerm(module, 'VIEW'),
    validateQuery(reportQuerySchema),
    wrap(async (req, res) => {
      const query = queryOf<ReturnType<typeof reportQuerySchema.parse>>(req);
      const table = await run(query, query.format === 'csv');
      if (query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        res.send(toCsv(table.columns, table.rows));
        return;
      }
      sendData(
        res,
        { title: table.title, kpis: table.kpis, columns: table.columns, rows: table.rows, truncated: Boolean(table.truncated) },
        pageMeta(query.page, query.pageSize, table.total),
      );
    }),
  ] as const;
}

export const reportsRouter = Router();
reportsRouter.get('/stock-summary', ...reportRoute('REPORTS', 'stock-summary', insights.stockSummaryReport));
reportsRouter.get('/stock-ledger', ...reportRoute('REPORTS', 'stock-ledger', insights.ledgerReport));
reportsRouter.get('/purchases', ...reportRoute('REPORTS', 'purchases', insights.purchaseReport));
reportsRouter.get('/production', ...reportRoute('REPORTS', 'production', insights.productionReport));
reportsRouter.get('/transfers', ...reportRoute('REPORTS', 'transfers', insights.transferReport));
reportsRouter.get('/shipments', ...reportRoute('REPORTS', 'shipments', insights.shipmentReport));
