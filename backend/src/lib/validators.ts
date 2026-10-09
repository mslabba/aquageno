import { z } from 'zod';
import { ACTIONS, MODULES } from './permissions';

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(72, 'Use at most 72 characters.')
  .regex(/[a-z]/, 'Include a lowercase letter.')
  .regex(/[A-Z]/, 'Include an uppercase letter.')
  .regex(/[0-9]/, 'Include a digit.');

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

export const qtySchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, 'Quantity can have at most 3 decimal places.')
  .refine((value) => Number(value) > 0, 'Quantity must be greater than zero.');

export const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Amount can have at most 2 decimal places.');

export const nonNegativeMoney = moneySchema.refine((value) => Number(value) >= 0, 'Amount cannot be negative.');

export const gstinSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value),
    'GSTIN is not in the expected format.',
  );

export const idSchema = z.string().trim().min(1);

const empty = (value: unknown) => (value === '' || value === undefined || value === null ? undefined : value);

export const pagingSchema = z.object({
  page: z.preprocess(empty, z.coerce.number().int().min(1).default(1)),
  pageSize: z.preprocess(empty, z.coerce.number().int().min(1).max(100).default(20)),
  search: z.preprocess(empty, z.string().trim().max(120).optional()),
  from: z.preprocess(empty, dateSchema.optional()),
  to: z.preprocess(empty, dateSchema.optional()),
});

export const pricedLineSchema = z.object({
  itemId: idSchema,
  quantity: qtySchema,
  unitPrice: nonNegativeMoney,
});

export const qtyLineSchema = z.object({
  itemId: idSchema,
  quantity: qtySchema,
});

export const adjustmentLineSchema = z.object({
  itemId: idSchema,
  quantity: qtySchema,
  direction: z.enum(['IN', 'OUT']),
});

export const purchaseSchema = z.object({
  supplierId: idSchema,
  invoiceNo: z.string().trim().min(1).max(60),
  invoiceDate: dateSchema,
  warehouseId: idSchema,
  notes: z.string().trim().max(2000).optional().default(''),
  lines: z.array(pricedLineSchema).min(1, 'Add at least one line.').max(200),
});

export const productionSchema = z.object({
  finishedItemId: idSchema,
  quantity: qtySchema,
  batchNo: z.string().trim().min(1).max(60),
  producedOn: dateSchema,
  warehouseId: idSchema,
  notes: z.string().trim().max(2000).optional().default(''),
  lines: z.array(qtyLineSchema).min(1, 'Add at least one consumption line.').max(200),
});

export const transferSchema = z.object({
  sourceWarehouseId: idSchema,
  destinationWarehouseId: idSchema,
  transferDate: dateSchema,
  notes: z.string().trim().max(2000).optional().default(''),
  lines: z.array(qtyLineSchema).min(1, 'Add at least one line.').max(200),
}).refine((value) => value.sourceWarehouseId !== value.destinationWarehouseId, {
  message: 'Source and destination warehouses must be different.',
  path: ['destinationWarehouseId'],
});

export const shipmentSchema = z.object({
  customerId: idSchema,
  shipmentDate: dateSchema,
  warehouseId: idSchema,
  vehicleNo: z.string().trim().max(60).optional().default(''),
  notes: z.string().trim().max(2000).optional().default(''),
  lines: z.array(pricedLineSchema).min(1, 'Add at least one line.').max(200),
});

export const adjustmentSchema = z.object({
  warehouseId: idSchema,
  adjustmentDate: dateSchema,
  reason: z.enum(['DAMAGE', 'COUNT_CORRECTION', 'EXPIRY', 'OTHER']),
  notes: z.string().trim().max(2000).optional().default(''),
  lines: z.array(adjustmentLineSchema).min(1, 'Add at least one line.').max(200),
});

export const approveSchema = z.object({
  remarks: z.string().trim().max(500).optional().nullable(),
});

export const rejectSchema = z.object({
  remarks: z.string().trim().min(3, 'Add a short reason.').max(500),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(1).max(72),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: passwordSchema,
});

export const forgotSchema = z.object({
  email: z.string().trim().email().max(160),
});

export const resetSchema = z.object({
  token: z.string().trim().min(20),
  newPassword: passwordSchema,
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  password: passwordSchema,
  roleId: idSchema,
  mustChangePassword: z.boolean().optional().default(true),
});

export const userPatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  roleId: idSchema.optional(),
  isActive: z.boolean().optional(),
  password: passwordSchema.optional(),
  mustChangePassword: z.boolean().optional(),
});

export const roleWriteSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional().default(''),
});

export const grantsSchema = z.object({
  grants: z.record(z.enum(MODULES), z.array(z.enum(ACTIONS))),
});

export const unitSchema = z.object({
  code: z.string().trim().min(1).max(12).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(60),
  isActive: z.boolean().optional().default(true),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  isActive: z.boolean().optional().default(true),
});

export const warehouseSchema = z.object({
  code: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300).optional().default(''),
  isActive: z.boolean().optional().default(true),
});

export const partySchema = z.object({
  code: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(120).optional().default(''),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.union([z.literal(''), z.string().trim().email().max(160)]).optional().default(''),
  address: z.string().trim().max(300).optional().default(''),
  gstin: gstinSchema.optional().default(''),
  isActive: z.boolean().optional().default(true),
});

export const itemSchema = z.object({
  sku: z.string().trim().min(1).max(40).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(160),
  itemType: z.enum(['RAW_MATERIAL', 'PACKING_MATERIAL', 'FINISHED_GOOD']),
  categoryId: idSchema,
  unitId: idSchema,
  reorderLevel: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,3})?$/, 'Reorder level can have at most 3 decimal places.'),
  standardCost: nonNegativeMoney,
  isActive: z.boolean().optional().default(true),
});

export const bomSchema = z.object({
  finishedItemId: idSchema,
  name: z.string().trim().min(1).max(120),
  isActive: z.boolean().optional().default(true),
  lines: z
    .array(
      z.object({
        itemId: idSchema,
        qtyPerUnit: qtySchema,
      }),
    )
    .min(1)
    .max(100),
});

export const docListSchema = pagingSchema.extend({
  status: z.preprocess(empty, z.enum(['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'POSTED', 'REVERSED']).optional()),
  warehouseId: z.preprocess(empty, z.string().optional()),
  supplierId: z.preprocess(empty, z.string().optional()),
  customerId: z.preprocess(empty, z.string().optional()),
  sort: z.preprocess(empty, z.enum(['createdAt', 'docNo', 'date']).default('createdAt')),
  order: z.preprocess(empty, z.enum(['asc', 'desc']).default('desc')),
});

export const masterListSchema = pagingSchema.extend({
  state: z.preprocess(empty, z.enum(['active', 'inactive', 'all']).default('active')),
  itemType: z.preprocess(
    empty,
    z.enum(['RAW_MATERIAL', 'PACKING_MATERIAL', 'FINISHED_GOOD']).optional(),
  ),
  finishedItemId: z.preprocess(empty, z.string().optional()),
});

export const reportQuerySchema = pagingSchema.extend({
  warehouseId: z.preprocess(empty, z.string().optional()),
  itemId: z.preprocess(empty, z.string().optional()),
  supplierId: z.preprocess(empty, z.string().optional()),
  customerId: z.preprocess(empty, z.string().optional()),
  itemType: z.preprocess(
    empty,
    z.enum(['RAW_MATERIAL', 'PACKING_MATERIAL', 'FINISHED_GOOD']).optional(),
  ),
  categoryId: z.preprocess(empty, z.string().optional()),
  belowReorder: z.preprocess(empty, z.enum(['true', 'false']).optional()),
  format: z.preprocess(empty, z.enum(['json', 'csv']).default('json')),
});

export const stockQuerySchema = pagingSchema.extend({
  warehouseId: z.preprocess(empty, z.string().optional()),
  itemId: z.preprocess(empty, z.string().optional()),
  belowReorder: z.preprocess(empty, z.enum(['true', 'false']).optional()),
});

export const approvalQuerySchema = pagingSchema.extend({
  status: z.preprocess(empty, z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).default('PENDING')),
  docType: z.preprocess(
    empty,
    z.enum(['PURCHASE', 'PRODUCTION', 'TRANSFER', 'SHIPMENT', 'ADJUSTMENT']).optional(),
  ),
});
