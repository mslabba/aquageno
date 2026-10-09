export type Named = { id: string; code?: string; name: string };

export type ItemOption = {
  id: string;
  sku: string;
  name: string;
  itemType: 'RAW_MATERIAL' | 'PACKING_MATERIAL' | 'FINISHED_GOOD';
  unit: { code: string; name?: string };
  category?: { name: string };
  standardCost: string;
  reorderLevel: string;
};

export type ReferenceData = {
  units: Array<{ id: string; code: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  warehouses: Named[];
  suppliers: Named[];
  customers: Named[];
  items: ItemOption[];
  roles: Array<{ id: string; name: string }>;
};

export type DocLine = {
  itemId: string;
  quantity: string;
  unitPrice?: string;
  lineTotal?: string;
  direction?: 'IN' | 'OUT';
  item?: { sku: string; name: string; unit?: { code: string } };
};

export type Doc = {
  id: string;
  docNo: string;
  status: string;
  notes: string;
  totalAmount?: string;
  isReversal?: boolean;
  rejectionRemarks?: string | null;
  invoiceNo?: string;
  invoiceDate?: string;
  supplierId?: string;
  supplier?: { name: string };
  warehouseId?: string;
  warehouse?: { name: string };
  finishedItemId?: string;
  finishedItem?: { name: string; sku: string };
  quantity?: string;
  batchNo?: string;
  producedOn?: string;
  sourceWarehouseId?: string;
  destinationWarehouseId?: string;
  sourceWarehouse?: { name: string; code: string };
  destinationWarehouse?: { name: string; code: string };
  transferDate?: string;
  customerId?: string;
  customer?: { name: string };
  shipmentDate?: string;
  vehicleNo?: string;
  adjustmentDate?: string;
  reason?: string;
  lines?: DocLine[];
  createdBy?: { name: string } | null;
  submittedBy?: { name: string } | null;
  approvedBy?: { name: string } | null;
  _count?: { lines: number };
};

export type FormLine = { itemId: string; quantity: string; unitPrice: string; direction: 'IN' | 'OUT' };

export type FormValues = {
  supplierId: string;
  invoiceNo: string;
  invoiceDate: string;
  warehouseId: string;
  notes: string;
  finishedItemId: string;
  quantity: string;
  batchNo: string;
  producedOn: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  transferDate: string;
  customerId: string;
  shipmentDate: string;
  vehicleNo: string;
  adjustmentDate: string;
  reason: 'DAMAGE' | 'COUNT_CORRECTION' | 'EXPIRY' | 'OTHER';
  lines: FormLine[];
};
