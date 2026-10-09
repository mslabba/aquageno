import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash } from '@phosphor-icons/react';
import { ApiError, api, can } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatInr, formatQty, lineTotal, STATUS_LABEL, statusTone, sumMoney, todayInput, reasonLabel, scaleQty } from '../lib/format';
import type { Doc, FormValues, ItemOption, PackingConfig, ReferenceData } from '../lib/types';
import { Badge, Banner, Button, Empty, Field, Modal, PageHeader, SelectInput, Spinner, TextArea, TextInput } from '../components/ui';

const qtyField = z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/, 'Use up to 3 decimals').refine((value) => Number(value) > 0, 'Enter a quantity');
const moneyField = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use up to 2 decimals');
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const priced = z.object({ itemId: z.string().min(1, 'Choose an item'), quantity: qtyField, unitPrice: moneyField, direction: z.enum(['IN', 'OUT']).optional() });
const consumed = z.object({ itemId: z.string().min(1, 'Choose an item'), quantity: qtyField, unitPrice: z.string().optional(), direction: z.enum(['IN', 'OUT']).optional() });
const caseQtyInput = z.string().trim().regex(/^\d{1,9}$/, 'Whole cases only').optional();
const looseSlabInput = z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/, 'Use up to 3 decimals').optional();
const caseLineBase = {
  itemId: z.string().min(1, 'Choose an item'),
  quantity: z.string().trim().optional(),
  cases: caseQtyInput,
  looseSlabs: looseSlabInput,
  unitPrice: z.string().optional(),
  direction: z.enum(['IN', 'OUT']).optional(),
};
const caseLineRefine = { message: 'Enter a quantity, or cases' };
const transferLineSchema = z.object(caseLineBase).refine(
  (v) => v.quantity?.trim() || v.cases?.trim() || v.looseSlabs?.trim(),
  caseLineRefine,
);
const shipmentLineSchema = z.object({ ...caseLineBase, unitPrice: moneyField }).refine(
  (v) => v.quantity?.trim() || v.cases?.trim() || v.looseSlabs?.trim(),
  caseLineRefine,
);
const adjusted = z.object({
  itemId: z.string().min(1, 'Choose an item'),
  quantity: qtyField,
  unitPrice: z.string().optional(),
  direction: z.enum(['IN', 'OUT']),
});

const schemas = {
  purchases: z.object({
    supplierId: z.string().min(1, 'Choose a supplier'),
    invoiceNo: z.string().trim().min(1, 'Invoice number is required'),
    invoiceDate: dateField,
    warehouseId: z.string().min(1, 'Choose a warehouse'),
    notes: z.string().optional(),
    lines: z.array(priced).min(1, 'Add at least one line'),
  }),
  production: z.object({
    finishedItemId: z.string().min(1, 'Choose a finished good'),
    quantity: qtyField,
    batchNo: z.string().trim().min(1, 'Batch number is required'),
    producedOn: dateField,
    warehouseId: z.string().min(1, 'Choose a warehouse'),
    notes: z.string().optional(),
    lines: z.array(consumed).min(1, 'Add at least one consumption line'),
  }),
  transfers: z.object({
    sourceWarehouseId: z.string().min(1),
    destinationWarehouseId: z.string().min(1),
    transferDate: dateField,
    notes: z.string().optional(),
    lines: z.array(transferLineSchema).min(1, 'Add at least one line'),
  }).refine((value) => value.sourceWarehouseId !== value.destinationWarehouseId, {
    message: 'Choose a different destination',
    path: ['destinationWarehouseId'],
  }),
  shipments: z.object({
    customerId: z.string().min(1, 'Choose a customer'),
    shipmentDate: dateField,
    warehouseId: z.string().min(1),
    vehicleNo: z.string().optional(),
    notes: z.string().optional(),
    lines: z.array(shipmentLineSchema).min(1, 'Add at least one line'),
  }),
  adjustments: z.object({
    warehouseId: z.string().min(1),
    adjustmentDate: dateField,
    reason: z.enum(['DAMAGE', 'COUNT_CORRECTION', 'EXPIRY', 'OTHER']),
    notes: z.string().optional(),
    lines: z.array(adjusted).min(1, 'Add at least one line'),
  }),
};

export type Kind = keyof typeof schemas;

const META: Record<Kind, { title: string; one: string; action: string; module: 'PURCHASES' | 'PRODUCTION' | 'TRANSFERS' | 'SHIPMENTS' | 'STOCK'; blurb: string; formTitle: string; formBlurb: string; lineLabel: string; priced: boolean; adjust: boolean }> = {
  purchases: {
    title: 'Purchase receipts',
    one: 'purchase',
    action: 'New purchase',
    module: 'PURCHASES',
    blurb: 'Raw material received and assigned to a plant.',
    formTitle: 'Record purchase receipt',
    formBlurb: 'Each line increases raw stock at the receiving plant once the receipt is posted.',
    lineLabel: 'Purchase lines',
    priced: true,
    adjust: false,
  },
  production: {
    title: 'Production batches',
    one: 'batch',
    action: 'New batch',
    module: 'PRODUCTION',
    blurb: 'Convert raw inputs into traceable finished stock.',
    formTitle: 'Complete production batch',
    formBlurb: 'Record the finished quantity, then add a line for every input consumed.',
    lineLabel: 'Consumption lines',
    priced: false,
    adjust: false,
  },
  transfers: {
    title: 'Inter-plant transfers',
    one: 'transfer',
    action: 'New transfer',
    module: 'TRANSFERS',
    blurb: 'One confirmation adjusts both source and destination stock.',
    formTitle: 'Transfer finished stock',
    formBlurb: 'Add a line for each stock item. Source and destination balances update together.',
    lineLabel: 'Transfer lines',
    priced: false,
    adjust: false,
  },
  shipments: {
    title: 'Sale & shipment',
    one: 'shipment',
    action: 'New shipment',
    module: 'SHIPMENTS',
    blurb: 'Availability checked before stock is deducted.',
    formTitle: 'Create shipment',
    formBlurb: 'Add a line for each item. Posted quantity is deducted from the dispatch plant.',
    lineLabel: 'Shipment lines',
    priced: true,
    adjust: false,
  },
  adjustments: {
    title: 'Adjustments',
    one: 'adjustment',
    action: 'New adjustment',
    module: 'STOCK',
    blurb: 'Correct stock with a reason. Posting is approval-gated.',
    formTitle: 'Adjust stock',
    formBlurb: 'Add a line for each item that needs a correction.',
    lineLabel: 'Adjustment lines',
    priced: false,
    adjust: true,
  },
};

function blankLine(): FormValues['lines'][number] {
  return { itemId: '', quantity: '', cases: '', looseSlabs: '', unitPrice: '', direction: 'OUT' };
}

function emptyForm(): FormValues {
  const today = todayInput();
  return {
    supplierId: '',
    invoiceNo: '',
    invoiceDate: today,
    warehouseId: '',
    notes: '',
    finishedItemId: '',
    quantity: '',
    batchNo: '',
    producedOn: today,
    sourceWarehouseId: '',
    destinationWarehouseId: '',
    transferDate: today,
    customerId: '',
    shipmentDate: today,
    vehicleNo: '',
    adjustmentDate: today,
    reason: 'DAMAGE',
    lines: [blankLine()],
  };
}

function fromDoc(doc: Doc): FormValues {
  const base = emptyForm();
  return {
    ...base,
    supplierId: doc.supplierId ?? '',
    invoiceNo: doc.invoiceNo ?? '',
    invoiceDate: doc.invoiceDate?.slice(0, 10) ?? base.invoiceDate,
    warehouseId: doc.warehouseId ?? '',
    notes: doc.notes ?? '',
    finishedItemId: doc.finishedItemId ?? '',
    quantity: doc.quantity ?? '',
    batchNo: doc.batchNo ?? '',
    producedOn: doc.producedOn?.slice(0, 10) ?? base.producedOn,
    sourceWarehouseId: doc.sourceWarehouseId ?? '',
    destinationWarehouseId: doc.destinationWarehouseId ?? '',
    transferDate: doc.transferDate?.slice(0, 10) ?? base.transferDate,
    customerId: doc.customerId ?? '',
    shipmentDate: doc.shipmentDate?.slice(0, 10) ?? base.shipmentDate,
    vehicleNo: doc.vehicleNo ?? '',
    adjustmentDate: doc.adjustmentDate?.slice(0, 10) ?? base.adjustmentDate,
    reason: (doc.reason as FormValues['reason']) ?? 'DAMAGE',
    lines: (doc.lines ?? []).map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      cases: line.cases ?? '',
      looseSlabs: line.looseSlabs ?? '',
      unitPrice: line.unitPrice ?? '',
      direction: line.direction ?? 'OUT',
    })),
  };
}

function payload(kind: Kind, values: FormValues) {
  const lines = values.lines.map((line) => {
    if (kind === 'adjustments') return { itemId: line.itemId, quantity: line.quantity, direction: line.direction };
    // Case-based entry: when cases/loose slabs are filled, the backend derives the slab quantity.
    if ((kind === 'transfers' || kind === 'shipments') && (line.cases?.trim() || line.looseSlabs?.trim())) {
      const entry: Record<string, string> = {
        itemId: line.itemId,
        cases: line.cases?.trim() || '0',
        looseSlabs: line.looseSlabs?.trim() || '0.000',
      };
      if (kind === 'shipments') entry.unitPrice = line.unitPrice;
      return entry;
    }
    if (kind === 'purchases' || kind === 'shipments') return { itemId: line.itemId, quantity: line.quantity, unitPrice: line.unitPrice };
    return { itemId: line.itemId, quantity: line.quantity };
  });
  if (kind === 'purchases') {
    return { supplierId: values.supplierId, invoiceNo: values.invoiceNo, invoiceDate: values.invoiceDate, warehouseId: values.warehouseId, notes: values.notes, lines };
  }
  if (kind === 'production') {
    return { finishedItemId: values.finishedItemId, quantity: values.quantity, batchNo: values.batchNo, producedOn: values.producedOn, warehouseId: values.warehouseId, notes: values.notes, lines };
  }
  if (kind === 'transfers') {
    return { sourceWarehouseId: values.sourceWarehouseId, destinationWarehouseId: values.destinationWarehouseId, transferDate: values.transferDate, notes: values.notes, lines };
  }
  if (kind === 'shipments') {
    return { customerId: values.customerId, shipmentDate: values.shipmentDate, warehouseId: values.warehouseId, vehicleNo: values.vehicleNo, notes: values.notes, lines };
  }
  return { warehouseId: values.warehouseId, adjustmentDate: values.adjustmentDate, reason: values.reason, notes: values.notes, lines };
}

function useReference() {
  return useQuery({
    queryKey: ['reference'],
    queryFn: () => api<ReferenceData>('/reference').then((result) => result.data),
  });
}

export function DocList({ kind }: { kind: Kind }) {
  const meta = META[kind];
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: [kind, search, status, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      return api<Doc[]>(`/${kind}?${params.toString()}`);
    },
  });

  return (
    <section>
      <PageHeader title={meta.title} description={meta.blurb}>
        {can(user, meta.module, 'CREATE') ? (
          <Link to={`/${kind}/new`}>
            <Button type="button"><Plus size={16} /> {meta.action}</Button>
          </Link>
        ) : null}
      </PageHeader>
      {kind === 'production' ? <ProductionFlow /> : null}
      {kind === 'purchases' ? <RawStrip /> : null}
      <div className="mb-3 flex flex-wrap gap-2">
        <TextInput className="max-w-xs" placeholder="Search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        <SelectInput className="max-w-[220px]" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </SelectInput>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-white">
        {query.isLoading ? <Spinner /> : null}
        {query.isError ? <Banner>Could not load {meta.title.toLowerCase()}.</Banner> : null}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-[#f8fafa] text-left text-[10px] tracking-wide text-muted uppercase">
              <tr>
                {columnsFor(kind).map((column) => (
                  <th key={column} className={`px-3.5 py-3 ${column === 'Quantity' || column === 'Value' || column === 'Lines' ? 'text-right' : ''}`}>{column}</th>
                ))}
                <th className="px-3.5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(query.data?.data ?? []).map((doc) => (
                <tr key={doc.id} className="border-t border-line hover:bg-sea-soft/30">
                  {cellsFor(kind, doc).map((cell) => (
                    <td key={cell.key} className={`px-3.5 py-3.5 align-middle ${cell.numeric ? 'text-right font-mono text-xs' : 'text-[13px]'}`}>
                      {cell.node}
                    </td>
                  ))}
                  <td className="px-3.5 py-3.5 text-right">
                    <Link className="text-[13px] font-bold text-sea-ink" to={`/${kind}/${doc.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 p-3 md:hidden">
          {(query.data?.data ?? []).map((doc) => (
            <Link key={doc.id} to={`/${kind}/${doc.id}`} className="rounded-xl border border-line p-3.5">
              <div className="mb-2 flex items-start justify-between gap-3">
                <span className="font-mono text-[13px] font-semibold">{doc.docNo}</span>
                <Badge tone={statusTone(doc.status)}>{STATUS_LABEL[doc.status] ?? doc.status}</Badge>
              </div>
              <b className="block text-sm">{party(kind, doc)}</b>
              <span className="mt-1 block text-xs text-muted">{linePreview(doc).title} · {formatDate(dateOf(kind, doc))}</span>
            </Link>
          ))}
        </div>
        {!query.isLoading && (query.data?.data.length ?? 0) === 0 ? <Empty>No {meta.title.toLowerCase()} match these filters.</Empty> : null}
      </div>
      <Pager page={page} totalPages={query.data?.meta?.totalPages ?? 0} onPage={setPage} />
    </section>
  );
}

function party(kind: Kind, doc: Doc) {
  if (kind === 'purchases') return doc.supplier?.name ?? '';
  if (kind === 'production') return doc.finishedItem ? `${doc.finishedItem.sku} ${doc.batchNo ?? ''}` : '';
  if (kind === 'transfers') return `${doc.sourceWarehouse?.code ?? ''} to ${doc.destinationWarehouse?.code ?? ''}`;
  if (kind === 'shipments') return doc.customer?.name ?? '';
  return doc.warehouse?.name ? `${reasonLabel(doc.reason ?? '')} at ${doc.warehouse.name}` : '';
}

function dateOf(kind: Kind, doc: Doc) {
  if (kind === 'purchases') return doc.invoiceDate;
  if (kind === 'production') return doc.producedOn;
  if (kind === 'transfers') return doc.transferDate;
  if (kind === 'shipments') return doc.shipmentDate;
  return doc.adjustmentDate;
}

function linePreview(doc: Doc) {
  const lines = doc.lines ?? [];
  if (!lines.length) return { title: 'No lines yet', sub: '', qty: '', unit: '' };
  const first = lines[0];
  const units = [...new Set(lines.map((line) => line.item?.unit?.code).filter((code): code is string => Boolean(code)))];
  const total = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  return {
    title: first?.item?.name ?? 'Item',
    sub: lines.length > 1 ? `+ ${lines.length - 1} more` : first?.item?.sku ?? '',
    qty: formatQty(total),
    unit: units.length === 1 ? units[0] : '',
  };
}

function columnsFor(kind: Kind) {
  if (kind === 'purchases') return ['Receipt', 'Supplier / bill', 'Receiving plant', 'Raw material', 'Quantity', 'Value', 'Status'];
  if (kind === 'production') return ['Batch', 'Plant / source', 'Raw input', 'Finished output', 'Status'];
  if (kind === 'transfers') return ['Transfer', 'Route', 'Item', 'Quantity', 'Status'];
  if (kind === 'shipments') return ['Shipment', 'Customer / destination', 'Dispatch plant', 'Lines', 'Quantity', 'Value', 'Status'];
  return ['Adjustment', 'Plant', 'Reason', 'Lines', 'Status'];
}

function titled(title: string, sub?: string) {
  return (
    <span>
      <span className="block font-bold">{title}</span>
      {sub ? <span className="mt-0.5 block text-[11px] font-normal text-muted">{sub}</span> : null}
    </span>
  );
}

function cellsFor(kind: Kind, doc: Doc): Array<{ key: string; numeric?: boolean; node: ReactNode }> {
  const preview = linePreview(doc);
  const status = <Badge tone={statusTone(doc.status)}>{STATUS_LABEL[doc.status] ?? doc.status}</Badge>;
  const code = <Link className="font-mono text-[13px] font-semibold" to={`/${kind}/${doc.id}`}>{doc.docNo}</Link>;
  const qty = `${preview.qty}${preview.unit ? ` ${preview.unit}` : ''}`;
  if (kind === 'purchases') {
    return [
      { key: 'no', node: code },
      { key: 'party', node: titled(doc.supplier?.name ?? '', doc.invoiceNo) },
      { key: 'plant', node: doc.warehouse?.name ?? '' },
      { key: 'item', node: titled(preview.title, preview.sub) },
      { key: 'qty', numeric: true, node: qty },
      { key: 'value', numeric: true, node: doc.totalAmount ? formatInr(doc.totalAmount) : '' },
      { key: 'status', node: status },
    ];
  }
  if (kind === 'production') {
    return [
      { key: 'no', node: code },
      { key: 'plant', node: titled(doc.warehouse?.name ?? '', doc.batchNo) },
      { key: 'raw', node: titled(preview.title, `${doc._count?.lines ?? doc.lines?.length ?? 0} lines`) },
      { key: 'out', node: titled(doc.finishedItem?.name ?? '', doc.quantity ? formatQty(doc.quantity) : '') },
      { key: 'status', node: status },
    ];
  }
  if (kind === 'transfers') {
    return [
      { key: 'no', node: code },
      { key: 'route', node: `${doc.sourceWarehouse?.name ?? ''} → ${doc.destinationWarehouse?.name ?? ''}` },
      { key: 'item', node: titled(preview.title, preview.sub) },
      { key: 'qty', numeric: true, node: qty },
      { key: 'status', node: status },
    ];
  }
  if (kind === 'shipments') {
    return [
      { key: 'no', node: code },
      { key: 'party', node: titled(doc.customer?.name ?? '', doc.vehicleNo || 'No destination') },
      { key: 'plant', node: doc.warehouse?.name ?? '' },
      { key: 'lines', numeric: true, node: String(doc._count?.lines ?? doc.lines?.length ?? 0) },
      { key: 'qty', numeric: true, node: qty },
      { key: 'value', numeric: true, node: doc.totalAmount ? formatInr(doc.totalAmount) : '' },
      { key: 'status', node: status },
    ];
  }
  return [
    { key: 'no', node: code },
    { key: 'plant', node: doc.warehouse?.name ?? '' },
    { key: 'reason', node: reasonLabel(doc.reason ?? '') },
    { key: 'lines', numeric: true, node: String(doc._count?.lines ?? doc.lines?.length ?? 0) },
    { key: 'status', node: status },
  ];
}

function ProductionFlow() {
  const steps = [
    ['01 · Source', 'Purchase receipt'],
    ['02 · Input', 'Raw stock by plant'],
    ['03 · Output', 'Finished quantity'],
    ['04 · Lines', 'Inputs consumed'],
    ['05 · Posting', 'Finished stock'],
  ];
  return (
    <div className="mb-5 hidden overflow-hidden rounded-[13px] border border-line bg-white md:grid md:grid-cols-5">
      {steps.map(([kicker, label], index) => (
        <div key={kicker} className={`relative px-3.5 py-3.5 ${index < 4 ? 'border-r border-line' : ''} ${index < 3 ? 'before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-ok' : ''}`}>
          <small className="mb-1 block text-[10px] text-muted">{kicker}</small>
          <b className="text-xs">{label}</b>
        </div>
      ))}
    </div>
  );
}

function RawStrip() {
  const query = useQuery({
    queryKey: ['raw-strip'],
    queryFn: () => api<Array<{ warehouse: string; itemType: string; quantity: string; unit: string }>>('/stock/balances?pageSize=100').then((result) => result.data),
  });
  const plants = new Map<string, { qty: number; unit: string }>();
  for (const row of query.data ?? []) {
    if (row.itemType !== 'RAW_MATERIAL') continue;
    const current = plants.get(row.warehouse) ?? { qty: 0, unit: row.unit };
    current.qty += Number(row.quantity || 0);
    plants.set(row.warehouse, current);
  }
  const rows = [...plants.entries()];
  if (!rows.length) return null;
  const peak = Math.max(...rows.map(([, row]) => row.qty), 1);
  return (
    <div className="mb-4 grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
      {rows.map(([name, row]) => (
        <article key={name} className="grid grid-cols-[1fr_auto] gap-3 rounded-[13px] border border-line bg-white p-4">
          <div>
            <h3 className="m-0 text-sm">{name}</h3>
            <p className="mt-1 mb-0 text-[11px] text-muted">Raw material on hand</p>
          </div>
          <strong className="font-mono text-xl">{formatQty(row.qty)} {row.unit}</strong>
          <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-[#f8fafa]">
            <i className="block h-full bg-[#64b9cc]" style={{ width: `${Math.max(8, (row.qty / peak) * 100)}%` }} />
          </div>
        </article>
      ))}
    </div>
  );
}

export function DocEditor({ kind }: { kind: Kind }) {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const meta = META[kind];
  const { user } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const reference = useReference();
  const existing = useQuery({
    queryKey: [kind, id],
    enabled: !isNew,
    queryFn: () => api<Doc>(`/${kind}/${id}`).then((result) => result.data),
  });
  const form = useForm<FormValues>({
    resolver: zodResolver(schemas[kind]) as Resolver<FormValues>,
    defaultValues: emptyForm(),
  });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const watched = form.watch();
  // Packing configurations: item id -> config, for case/slab entry and live splits.
  const packingQuery = useQuery({
    queryKey: ['packing-configs-form'],
    queryFn: () => api<PackingConfig[]>('/packing-configs?pageSize=200').then((result) => result.data),
  });
  const packingMap = useMemo(
    () => new Map((packingQuery.data ?? []).filter((c) => c.isActive).map((c) => [c.finishedItemId, c])),
    [packingQuery.data],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [bomId, setBomId] = useState('');

  useEffect(() => {
    if (existing.data) form.reset(fromDoc(existing.data));
  }, [existing.data, form]);

  const status = existing.data?.status ?? 'DRAFT';
  const editable = (isNew && can(user, meta.module, 'CREATE')) || (status === 'DRAFT' && can(user, meta.module, 'EDIT'));
  const items = reference.data?.items ?? [];
  const lineItems = kind === 'production' ? items.filter((item) => item.itemType !== 'FINISHED_GOOD') : items;
  const finished = items.filter((item) => item.itemType === 'FINISHED_GOOD');
  const warehouseForStock = kind === 'transfers' ? watched.sourceWarehouseId : watched.warehouseId;
  const onHand = useQuery({
    queryKey: ['on-hand', warehouseForStock],
    enabled: Boolean(warehouseForStock) && kind !== 'purchases',
    queryFn: () => api<Array<{ itemId: string; quantity: string }>>(`/stock/on-hand?warehouseId=${warehouseForStock}`).then((result) => result.data),
  });
  const handMap = useMemo(() => new Map((onHand.data ?? []).map((row) => [row.itemId, row.quantity])), [onHand.data]);
  const boms = useQuery({
    queryKey: ['boms', watched.finishedItemId],
    enabled: kind === 'production' && Boolean(watched.finishedItemId),
    queryFn: () =>
      api<Array<{ id: string; name: string; lines: Array<{ itemId: string; qtyPerUnit: string }> }>>(
        `/boms?finishedItemId=${watched.finishedItemId}&pageSize=50`,
      ).then((result) => result.data),
  });

  const grand = sumMoney(
    (watched.lines ?? []).map((line) => (meta.priced ? lineTotal(line.quantity, line.unitPrice) : '0')),
  );
  const quantityTotal = (watched.lines ?? []).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const overdrawn = kind !== 'purchases' && (watched.lines ?? []).some((line) => {
    const available = line.itemId ? handMap.get(line.itemId) : undefined;
    return available !== undefined && Number(line.quantity) > Number(available);
  });

  async function persist(values: FormValues) {
    const body = payload(kind, values);
    if (isNew) {
      const created = await api<Doc>(`/${kind}`, { method: 'POST', body });
      return created.data;
    }
    const updated = await api<Doc>(`/${kind}/${id}`, { method: 'PATCH', body });
    return updated.data;
  }

  async function save(values: FormValues, andSubmit = false) {
    setBusy(true);
    setError('');
    try {
      const saved = await persist(values);
      if (andSubmit) await api(`/${kind}/${saved.id}/submit`, { method: 'POST', body: {} });
      await client.invalidateQueries({ queryKey: [kind] });
      navigate(`/${kind}/${saved.id}`);
      if (!isNew) await existing.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the document.');
    } finally {
      setBusy(false);
    }
  }

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError('');
    try {
      await api(`/${kind}/${id}${path}`, { method: 'POST', body: body ?? {} });
      await existing.refetch();
      await client.invalidateQueries({ queryKey: ['on-hand'] });
      await client.invalidateQueries({ queryKey: ['unread'] });
      if (path === '/reverse') {
        const fresh = await api<Doc>(`/${kind}/${id}`);
        void fresh;
      }
      if (path === '/delete') navigate(`/${kind}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That action failed.');
    } finally {
      setBusy(false);
      setRejectOpen(false);
    }
  }

  function loadBom() {
    const bom = boms.data?.find((row) => row.id === bomId);
    if (!bom) return;
    if (!watched.quantity) {
      setError('Enter the finished quantity before loading a BOM.');
      return;
    }
    form.setValue(
      'lines',
      bom.lines.map((line) => ({
        itemId: line.itemId,
        quantity: scaleQty(line.qtyPerUnit, watched.quantity),
        cases: '',
        looseSlabs: '',
        unitPrice: '',
        direction: 'OUT' as const,
      })),
    );
  }

  if (!isNew && existing.isLoading) return <Spinner />;
  if (!isNew && existing.isError) return <Banner>That document was not found.</Banner>;

  return (
    <section>
      <PageHeader title={isNew ? meta.formTitle : existing.data?.docNo ?? meta.formTitle} description={meta.formBlurb}>
        <Link to={`/${kind}`} className="text-sm font-bold text-sea-ink">Back to list</Link>
      </PageHeader>
      {existing.data ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <Badge tone={statusTone(existing.data.status)}>{STATUS_LABEL[existing.data.status]}</Badge>
          {existing.data.isReversal ? <Badge tone="info">Reversal</Badge> : null}
          <span className="text-muted">Created by {existing.data.createdBy?.name ?? 'unknown'}</span>
          {existing.data.rejectionRemarks ? <span className="text-danger">Rejected: {existing.data.rejectionRemarks}</span> : null}
        </div>
      ) : null}
      {error ? <Banner>{error}</Banner> : null}
      <form className="grid gap-4" onSubmit={form.handleSubmit((values) => save(values, false))}>
        <div className="grid gap-3 rounded-xl border border-line bg-white p-4 md:grid-cols-2">
          {kind === 'purchases' ? (
            <>
              <Field label="Supplier" error={form.formState.errors.supplierId?.message}>
                <SelectInput disabled={!editable} {...form.register('supplierId')}>
                  <option value="">Select</option>
                  {reference.data?.suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </SelectInput>
              </Field>
              <Field label="Supplier bill no." error={form.formState.errors.invoiceNo?.message}>
                <TextInput disabled={!editable} {...form.register('invoiceNo')} />
              </Field>
              <Field label="Receipt date">
                <TextInput type="date" disabled={!editable} {...form.register('invoiceDate')} />
              </Field>
              <Field label="Receiving plant" error={form.formState.errors.warehouseId?.message}>
                <SelectInput disabled={!editable} {...form.register('warehouseId')}>
                  <option value="">Select</option>
                  {reference.data?.warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </SelectInput>
              </Field>
            </>
          ) : null}
          {kind === 'production' ? (
            <>
              <Field label="Finished good" error={form.formState.errors.finishedItemId?.message}>
                <SelectInput disabled={!editable} {...form.register('finishedItemId')}>
                  <option value="">Select</option>
                  {finished.map((row) => <option key={row.id} value={row.id}>{row.sku} - {row.name}</option>)}
                </SelectInput>
              </Field>
              <Field label="Quantity" error={form.formState.errors.quantity?.message}>
                <TextInput disabled={!editable} {...form.register('quantity')} />
                {(() => {
                  const pc = watched.finishedItemId ? packingMap.get(watched.finishedItemId) : undefined;
                  const slabs = Number(watched.quantity);
                  if (!pc || !slabs || slabs <= 0) return null;
                  const cases = Math.floor(slabs / pc.slabsPerCase);
                  const loose = slabs - cases * pc.slabsPerCase;
                  const net = slabs * Number(pc.slabWeightKg);
                  return (
                    <span className="text-[11px] text-muted">
                      {cases} cases + {loose.toFixed(3)} loose slabs · {net.toFixed(3)} kg net ({pc.slabsPerCase} slabs/case, {pc.grade})
                    </span>
                  );
                })()}
              </Field>
              <Field label="Batch / lot" error={form.formState.errors.batchNo?.message}>
                <TextInput disabled={!editable} {...form.register('batchNo')} />
              </Field>
              <Field label="Date">
                <TextInput type="date" disabled={!editable} {...form.register('producedOn')} />
              </Field>
              <Field label="Warehouse">
                <SelectInput disabled={!editable} {...form.register('warehouseId')}>
                  <option value="">Select</option>
                  {reference.data?.warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </SelectInput>
              </Field>
              <Field label="Saved BOM">
                <div className="flex gap-2">
                  <SelectInput disabled={!editable} value={bomId} onChange={(event) => setBomId(event.target.value)}>
                    <option value="">Select</option>
                    {(boms.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </SelectInput>
                  <Button type="button" variant="secondary" disabled={!editable || !bomId} onClick={loadBom}>Load BOM</Button>
                </div>
              </Field>
            </>
          ) : null}
          {kind === 'transfers' ? (
            <>
              <Field label="From plant" error={form.formState.errors.sourceWarehouseId?.message}>
                <SelectInput disabled={!editable} {...form.register('sourceWarehouseId')}>
                  <option value="">Select</option>
                  {reference.data?.warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </SelectInput>
              </Field>
              <Field label="To plant" error={form.formState.errors.destinationWarehouseId?.message}>
                <SelectInput disabled={!editable} {...form.register('destinationWarehouseId')}>
                  <option value="">Select</option>
                  {reference.data?.warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </SelectInput>
              </Field>
              <Field label="Date">
                <TextInput type="date" disabled={!editable} {...form.register('transferDate')} />
              </Field>
            </>
          ) : null}
          {kind === 'shipments' ? (
            <>
              <Field label="Customer" error={form.formState.errors.customerId?.message}>
                <SelectInput disabled={!editable} {...form.register('customerId')}>
                  <option value="">Select</option>
                  {reference.data?.customers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </SelectInput>
              </Field>
              <Field label="Shipment date">
                <TextInput type="date" disabled={!editable} {...form.register('shipmentDate')} />
              </Field>
              <Field label="Dispatch plant">
                <SelectInput disabled={!editable} {...form.register('warehouseId')}>
                  <option value="">Select</option>
                  {reference.data?.warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </SelectInput>
              </Field>
              <Field label="Destination">
                <TextInput disabled={!editable} placeholder="Port, city, or vehicle" {...form.register('vehicleNo')} />
              </Field>
            </>
          ) : null}
          {kind === 'adjustments' ? (
            <>
              <Field label="Warehouse">
                <SelectInput disabled={!editable} {...form.register('warehouseId')}>
                  <option value="">Select</option>
                  {reference.data?.warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </SelectInput>
              </Field>
              <Field label="Date">
                <TextInput type="date" disabled={!editable} {...form.register('adjustmentDate')} />
              </Field>
              <Field label="Reason">
                <SelectInput disabled={!editable} {...form.register('reason')}>
                  <option value="DAMAGE">Damage</option>
                  <option value="COUNT_CORRECTION">Count correction</option>
                  <option value="EXPIRY">Expiry</option>
                  <option value="OTHER">Other</option>
                </SelectInput>
              </Field>
            </>
          ) : null}
          <Field label="Notes" className="md:col-span-2">
            <TextArea disabled={!editable} {...form.register('notes')} />
          </Field>
        </div>

        <div className="rounded-[13px] border border-line bg-white px-4 py-4 md:px-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[11px] font-bold tracking-wide text-muted uppercase">{meta.lineLabel}</span>
            {editable ? (
              <Button type="button" variant="ghost" onClick={() => lines.append(blankLine())}>
                <Plus size={16} /> Add line
              </Button>
            ) : null}
          </div>
          <div className="grid gap-2">
            {lines.fields.map((field, index) => {
              const line = watched.lines?.[index];
              const available = line?.itemId ? handMap.get(line.itemId) : undefined;
              const packing = line?.itemId ? packingMap.get(line.itemId) : undefined;
              const caseEntry = (kind === 'transfers' || kind === 'shipments') && packing;
              return (
                <div key={field.id} className={`grid items-end gap-2 ${meta.priced ? 'md:grid-cols-[minmax(0,1.4fr)_minmax(0,.7fr)_minmax(0,.7fr)_auto]' : meta.adjust ? 'md:grid-cols-[minmax(0,1.4fr)_minmax(0,.7fr)_minmax(0,.7fr)_auto]' : 'md:grid-cols-[minmax(0,1.6fr)_minmax(0,.7fr)_auto]'}`}>
                  <Field label={kind === 'purchases' ? 'Raw material' : 'Stock item'} error={form.formState.errors.lines?.[index]?.itemId?.message}>
                    <SelectInput disabled={!editable} {...form.register(`lines.${index}.itemId`)}>
                      <ItemOptions items={lineItems} />
                    </SelectInput>
                    {available !== undefined ? <span className="text-[11px] text-muted">On hand {formatQty(available)}</span> : null}
                    {packing ? <span className="text-[11px] text-muted">{packing.slabsPerCase} slabs/case · {packing.grade}</span> : null}
                  </Field>
                  {caseEntry ? (
                    <>
                      <Field label="Cases" error={form.formState.errors.lines?.[index]?.cases?.message}>
                        <TextInput disabled={!editable} inputMode="numeric" placeholder="0" {...form.register(`lines.${index}.cases`)} />
                      </Field>
                      <Field label="Loose slabs" error={form.formState.errors.lines?.[index]?.looseSlabs?.message}>
                        <TextInput disabled={!editable} inputMode="decimal" placeholder="0.000" {...form.register(`lines.${index}.looseSlabs`)} />
                      </Field>
                    </>
                  ) : (
                    <Field label="Quantity" error={form.formState.errors.lines?.[index]?.quantity?.message}>
                      <TextInput disabled={!editable} inputMode="decimal" {...form.register(`lines.${index}.quantity`)} />
                    </Field>
                  )}
                  {meta.priced ? (
                    <Field label="Rate (₹ / unit)" error={form.formState.errors.lines?.[index]?.unitPrice?.message}>
                      <TextInput disabled={!editable} inputMode="decimal" {...form.register(`lines.${index}.unitPrice`)} />
                    </Field>
                  ) : null}
                  {meta.adjust ? (
                    <Field label="Direction">
                      <SelectInput disabled={!editable} {...form.register(`lines.${index}.direction`)}>
                        <option value="OUT">Out</option>
                        <option value="IN">In</option>
                      </SelectInput>
                    </Field>
                  ) : null}
                  {editable ? (
                    <button type="button" className="grid h-[41px] w-[41px] place-items-center rounded-lg border border-line text-danger" onClick={() => lines.remove(index)} aria-label="Remove line">
                      <Trash size={16} />
                    </button>
                  ) : <span />}
                </div>
              );
            })}
          </div>
          {lines.fields.length === 0 ? <Empty>Add a line to continue.</Empty> : null}
          <div className={`mt-3 grid gap-2 rounded-[11px] bg-sea-soft p-3.5 text-sea-ink ${meta.priced ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3'}`}>
            <Calc label="Lines" value={String(lines.fields.length)} />
            <Calc label="Quantity" value={formatQty(quantityTotal)} />
            {meta.priced ? <Calc label="Value" value={formatInr(grand)} /> : null}
            <Calc label={kind === 'transfers' ? 'Route' : 'Plant'} value={plantCaption(kind, watched, reference.data)} />
          </div>
          {overdrawn ? (
            <div className="mt-3 rounded-[9px] bg-warn-soft px-3 py-2.5 text-[11px] font-semibold text-warn">
              Requested quantity exceeds available stock at the selected plant.
            </div>
          ) : null}
          {typeof form.formState.errors.lines?.message === 'string' ? (
            <p className="mt-2 text-sm text-danger">{form.formState.errors.lines.message}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {editable ? <Button type="submit" disabled={busy}>Save draft</Button> : null}
          {editable ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={form.handleSubmit((values) => save(values, true))}>
              Submit for approval
            </Button>
          ) : null}
          {!isNew && status === 'DRAFT' && can(user, meta.module, 'DELETE') ? (
            <Button type="button" variant="danger" disabled={busy} onClick={() => act('/delete')}>Delete draft</Button>
          ) : null}
          {!isNew && status === 'REJECTED' && can(user, meta.module, 'EDIT') ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => act('/reopen')}>Reopen draft</Button>
          ) : null}
          {!isNew && status === 'PENDING_APPROVAL' && can(user, meta.module, 'APPROVE') && can(user, 'APPROVALS', 'APPROVE') ? (
            <>
              <Button type="button" disabled={busy} onClick={() => act('/approve', { remarks: '' })}>Approve and post</Button>
              <Button type="button" variant="danger" disabled={busy} onClick={() => setRejectOpen(true)}>Reject</Button>
            </>
          ) : null}
          {!isNew && status === 'POSTED' && !existing.data?.isReversal && can(user, meta.module, 'CREATE') ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                const created = await api<Doc>(`/${kind}/${id}/reverse`, { method: 'POST', body: {} });
                navigate(`/${kind}/${created.data.id}`);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Could not start a reversal.');
              } finally {
                setBusy(false);
              }
            }}>Start reversal</Button>
          ) : null}
        </div>
      </form>
      {rejectOpen ? (
        <Modal title="Reject document" description="The submitter will see these remarks." onClose={() => setRejectOpen(false)} footer={
          <Button type="button" variant="danger" disabled={remarks.trim().length < 3 || busy} onClick={() => act('/reject', { remarks })}>Reject</Button>
        }>
          <Field label="Remarks">
            <TextArea value={remarks} onChange={(event) => setRemarks(event.target.value)} />
          </Field>
        </Modal>
      ) : null}
    </section>
  );
}

function plantCaption(kind: Kind, values: FormValues, reference?: ReferenceData) {
  const name = (id?: string) => reference?.warehouses.find((row) => row.id === id)?.name ?? '—';
  if (kind === 'transfers') {
    const from = name(values.sourceWarehouseId);
    const to = name(values.destinationWarehouseId);
    return from === '—' && to === '—' ? '—' : `${from} → ${to}`;
  }
  return name(values.warehouseId);
}

function Calc({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-1 block text-[10px] tracking-wide uppercase">{label}</span>
      <strong className="font-mono text-[13px]">{value}</strong>
    </div>
  );
}

function ItemOptions({ items }: { items: ItemOption[] }) {
  const groups = [
    ['RAW_MATERIAL', 'Raw materials'],
    ['FINISHED_GOOD', 'Finished goods'],
    ['PACKING_MATERIAL', 'Packing materials'],
  ] as const;
  return (
    <>
      <option value="">Select</option>
      {groups.map(([type, label]) => {
        const rows = items.filter((item) => item.itemType === type);
        if (!rows.length) return null;
        return (
          <optgroup key={type} label={label}>
            {rows.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
          </optgroup>
        );
      })}
    </>
  );
}

function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center gap-2 text-sm">
      <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="text-muted">Page {page} of {totalPages}</span>
      <Button type="button" variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}
