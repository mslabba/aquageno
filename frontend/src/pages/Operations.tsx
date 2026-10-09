import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, can, downloadCsv } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatInr, formatQty, itemTypeLabel } from '../lib/format';
import type { ReferenceData } from '../lib/types';
import { Badge, Banner, Button, Empty, Field, Modal, PageHeader, SelectInput, Spinner, TextArea, TextInput } from '../components/ui';

function useReference() {
  return useQuery({ queryKey: ['reference'], queryFn: () => api<ReferenceData>('/reference').then((result) => result.data) });
}

export function StockPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [below, setBelow] = useState(false);
  const [page, setPage] = useState(1);
  const reference = useReference();
  const query = useQuery({
    queryKey: ['balances', search, warehouseId, below, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (search) params.set('search', search);
      if (warehouseId) params.set('warehouseId', warehouseId);
      if (below) params.set('belowReorder', 'true');
      return api<Array<Record<string, string>>>(`/stock/balances?${params}`);
    },
  });
  const rows = query.data?.data ?? [];
  return (
    <section>
      <PageHeader title="Location-wise finished stock" description="On-hand quantity is calculated from the ledger, not edited by hand.">
        {can(user, 'TRANSFERS', 'CREATE') ? (
          <Link to="/transfers/new" className="inline-flex min-h-10 items-center rounded-[9px] border border-line bg-white px-3 text-[13px] font-bold">Move stock</Link>
        ) : null}
        <Link to="/stock/ledger" className="inline-flex min-h-10 items-center rounded-[9px] border border-line bg-white px-3 text-[13px] font-bold">Stock ledger</Link>
      </PageHeader>
      <div className="mb-3 flex flex-wrap gap-2">
        <TextInput className="max-w-xs" placeholder="Search SKU or name" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        <SelectInput className="max-w-[220px]" value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setPage(1); }}>
          <option value="">All warehouses</option>
          {reference.data?.warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </SelectInput>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={below} onChange={(event) => { setBelow(event.target.checked); setPage(1); }} />
          Below reorder
        </label>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        {query.isLoading ? <Spinner /> : null}
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-[#f8fafa] text-left text-[11px] tracking-wide text-muted uppercase">
            <tr>
              <th className="px-3 py-3">Location</th>
              <th className="px-3 py-3">Product</th>
              <th className="px-3 py-3 text-right">On hand</th>
              <th className="px-3 py-3 text-right">Reorder</th>
              <th className="px-3 py-3 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.itemId}-${row.warehouseId}-${index}`} className="border-t border-line">
                <td className="px-3 py-3">{row.warehouse}</td>
                <td className="px-3 py-3">
                  <b>{row.sku}</b>
                  <span className="mt-1 block text-xs text-muted">{row.name} · {itemTypeLabel(row.itemType)}</span>
                </td>
                <td className="px-3 py-3 text-right font-mono">{formatQty(row.quantity)} {row.unit}</td>
                <td className="px-3 py-3 text-right font-mono">{formatQty(row.reorderLevel)}</td>
                <td className="px-3 py-3 text-right font-mono">{formatInr(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!query.isLoading && rows.length === 0 ? <Empty>No stock rows match these filters.</Empty> : null}
      </div>
    </section>
  );
}

export function LedgerPage() {
  const reference = useReference();
  const [filters, setFilters] = useState({ from: '', to: '', itemId: '', warehouseId: '', supplierId: '', customerId: '' });
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  const query = useQuery({
    queryKey: ['ledger', filters, page],
    queryFn: () => api<{ columns: Array<{ key: string; label: string }>; rows: Array<Record<string, string>>; kpis: Array<{ label: string; value: string }> }>(`/stock/ledger?${params}`),
  });
  return (
    <section>
      <PageHeader title="Stock ledger" description="Every movement, with a running balance per item and warehouse.">
        <Button type="button" variant="secondary" onClick={() => downloadCsv(`/stock/ledger?${new URLSearchParams({ ...filters, format: 'csv' })}`, 'stock-ledger.csv')}>Export CSV</Button>
      </PageHeader>
      <FilterBar reference={reference.data} filters={filters} onChange={(next) => { setFilters(next); setPage(1); }} showItem showWarehouse />
      {query.data ? <Kpis items={query.data.data.kpis} /> : null}
      <ReportTable loading={query.isLoading} columns={query.data?.data.columns ?? []} rows={query.data?.data.rows ?? []} />
    </section>
  );
}

const REPORTS = [
  { id: 'stock-summary', label: 'Stock position' },
  { id: 'purchases', label: 'Purchase summary' },
  { id: 'production', label: 'Production yield' },
  { id: 'transfers', label: 'Transfer log' },
  { id: 'shipments', label: 'Shipment sales' },
  { id: 'stock-ledger', label: 'Stock ledger' },
] as const;

export function ReportsPage() {
  const reference = useReference();
  const [report, setReport] = useState<(typeof REPORTS)[number]['id']>('stock-summary');
  const [filters, setFilters] = useState({ from: '', to: '', warehouseId: '', itemId: '', supplierId: '', customerId: '' });
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  const query = useQuery({
    queryKey: ['report', report, filters, page],
    queryFn: () => api<{ title: string; kpis: Array<{ label: string; value: string }>; columns: Array<{ key: string; label: string; type?: string }>; rows: Array<Record<string, string>> }>(`/reports/${report}?${params}`),
  });
  return (
    <section>
      <PageHeader title="Operational reports" description="Review stock, purchases, production, transfers, and shipment values.">
        <Button type="button" variant="secondary" onClick={() => downloadCsv(`/reports/${report}?${new URLSearchParams({ ...filters, format: 'csv' })}`, `${report}.csv`)}>Export CSV</Button>
      </PageHeader>
      <div className="mb-3 flex flex-wrap gap-2">
        {REPORTS.map((item) => (
          <button key={item.id} type="button" className={`rounded-lg px-3 py-2 text-sm font-bold ${report === item.id ? 'bg-sea text-white' : 'border border-line bg-white'}`} onClick={() => { setReport(item.id); setPage(1); }}>
            {item.label}
          </button>
        ))}
      </div>
      <FilterBar
        reference={reference.data}
        filters={filters}
        onChange={(next) => { setFilters(next); setPage(1); }}
        showItem
        showWarehouse
        showSupplier={report === 'purchases'}
        showCustomer={report === 'shipments'}
      />
      {query.data ? <Kpis items={query.data.data.kpis} /> : null}
      <ReportTable loading={query.isLoading} columns={query.data?.data.columns ?? []} rows={query.data?.data.rows ?? []} />
      <div className="mt-3 text-sm text-muted">Page {page} of {query.data?.meta?.totalPages || 1}</div>
      <div className="mt-2 flex gap-2">
        <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        <Button type="button" variant="secondary" disabled={page >= (query.data?.meta?.totalPages || 1)} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </section>
  );
}

function Kpis({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <article key={item.label} className="rounded-xl border border-line bg-white p-4">
          <div className="text-xs font-bold text-muted">{item.label}</div>
          <div className="mt-2 font-mono text-xl">{item.value}</div>
        </article>
      ))}
    </div>
  );
}

function ReportTable({ loading, columns, rows }: { loading: boolean; columns: Array<{ key: string; label: string; type?: string }>; rows: Array<Record<string, string>> }) {
  if (loading) return <Spinner />;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-[#f8fafa] text-left text-[11px] tracking-wide text-muted uppercase">
          <tr>{columns.map((column) => <th key={column.key} className="px-3 py-3">{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-line">
              {columns.map((column) => (
                <td key={column.key} className={`px-3 py-2 ${column.type ? 'text-right font-mono' : ''}`}>
                  {column.type === 'money' ? formatInr(row[column.key]) : column.type === 'qty' ? formatQty(row[column.key]) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <Empty>No rows for these filters.</Empty> : null}
    </div>
  );
}

function FilterBar({
  reference,
  filters,
  onChange,
  showItem,
  showWarehouse,
  showSupplier,
  showCustomer,
}: {
  reference?: ReferenceData;
  filters: { from: string; to: string; warehouseId: string; itemId: string; supplierId: string; customerId: string };
  onChange: (next: typeof filters) => void;
  showItem?: boolean;
  showWarehouse?: boolean;
  showSupplier?: boolean;
  showCustomer?: boolean;
}) {
  const set = (key: keyof typeof filters, value: string) => onChange({ ...filters, [key]: value });
  return (
    <div className="mb-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
      <TextInput type="date" value={filters.from} onChange={(event) => set('from', event.target.value)} aria-label="From date" />
      <TextInput type="date" value={filters.to} onChange={(event) => set('to', event.target.value)} aria-label="To date" />
      {showWarehouse ? (
        <SelectInput value={filters.warehouseId} onChange={(event) => set('warehouseId', event.target.value)}>
          <option value="">All warehouses</option>
          {reference?.warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </SelectInput>
      ) : null}
      {showItem ? (
        <SelectInput value={filters.itemId} onChange={(event) => set('itemId', event.target.value)}>
          <option value="">All items</option>
          {reference?.items.map((row) => <option key={row.id} value={row.id}>{row.sku}</option>)}
        </SelectInput>
      ) : null}
      {showSupplier ? (
        <SelectInput value={filters.supplierId} onChange={(event) => set('supplierId', event.target.value)}>
          <option value="">All suppliers</option>
          {reference?.suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </SelectInput>
      ) : null}
      {showCustomer ? (
        <SelectInput value={filters.customerId} onChange={(event) => set('customerId', event.target.value)}>
          <option value="">All customers</option>
          {reference?.customers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </SelectInput>
      ) : null}
    </div>
  );
}

type Task = {
  id: string;
  docType: string;
  docId: string;
  docNo: string;
  summary: string;
  amount: string;
  submittedAt: string;
  status: string;
  submittedBy: { name: string };
};

export function ApprovalsPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const query = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api<Task[]>('/approvals?status=PENDING&pageSize=50'),
  });

  async function decide(id: string, action: 'approve' | 'reject', note?: string) {
    setError('');
    try {
      await api(`/approvals/${id}/${action}`, { method: 'POST', body: { remarks: note ?? '' } });
      await query.refetch();
      await client.invalidateQueries({ queryKey: ['unread'] });
      setRejectId(null);
      setRemarks('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the decision.');
    }
  }

  const canApprove = can(user, 'APPROVALS', 'APPROVE');
  return (
    <section>
      <PageHeader title="Approvals" description="Documents waiting to be posted. Approval moves stock." />
      {error ? <Banner>{error}</Banner> : null}
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        {query.isLoading ? <Spinner /> : null}
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-[#f8fafa] text-left text-[11px] tracking-wide text-muted uppercase">
            <tr>
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3">Document</th>
              <th className="px-3 py-3">Submitted by</th>
              <th className="px-3 py-3 text-right">Amount</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {(query.data?.data ?? []).map((task) => (
              <tr key={task.id} className="border-t border-line">
                <td className="px-3 py-3"><Badge>{task.docType}</Badge></td>
                <td className="px-3 py-3">
                  <b className="font-mono">{task.docNo}</b>
                  <span className="mt-1 block text-xs text-muted">{task.summary}</span>
                </td>
                <td className="px-3 py-3">{task.submittedBy.name}<span className="mt-1 block text-xs text-muted">{formatDateTime(task.submittedAt)}</span></td>
                <td className="px-3 py-3 text-right font-mono">{formatInr(task.amount)}</td>
                <td className="px-3 py-3">
                  {canApprove ? (
                    <div className="flex justify-end gap-2">
                      <Button type="button" onClick={() => decide(task.id, 'approve')}>Approve</Button>
                      <Button type="button" variant="danger" onClick={() => { setRejectId(task.id); setRemarks(''); }}>Reject</Button>
                    </div>
                  ) : <span className="text-xs text-muted">View only</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!query.isLoading && (query.data?.data.length ?? 0) === 0 ? <Empty>Nothing is waiting for approval.</Empty> : null}
      </div>
      {rejectId ? (
        <Modal title="Reject" onClose={() => setRejectId(null)} footer={<Button type="button" variant="danger" disabled={remarks.trim().length < 3} onClick={() => decide(rejectId, 'reject', remarks)}>Reject</Button>}>
          <Field label="Remarks">
            <TextArea value={remarks} onChange={(event) => setRemarks(event.target.value)} />
          </Field>
        </Modal>
      ) : null}
    </section>
  );
}

export function NotificationsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Array<{ id: string; title: string; body: string; readAt: string | null; createdAt: string }>>('/notifications?pageSize=50'),
  });
  async function read(id?: string) {
    if (id) await api(`/notifications/${id}/read`, { method: 'POST', body: {} });
    else await api('/notifications/read-all', { method: 'POST', body: {} });
    await query.refetch();
    await client.invalidateQueries({ queryKey: ['unread'] });
  }
  return (
    <section>
      <PageHeader title="Notifications" description="Approval requests, decisions, and low-stock alerts.">
        <Button type="button" variant="secondary" onClick={() => read()}>Mark all read</Button>
      </PageHeader>
      <ul className="m-0 list-none rounded-xl border border-line bg-white">
        {(query.data?.data ?? []).map((note) => (
          <li key={note.id} className="flex items-start justify-between gap-4 border-b border-line px-4 py-3 last:border-0">
            <div>
              <b className="block text-sm">{note.title}</b>
              <p className="mt-1 mb-0 text-sm text-muted">{note.body}</p>
              <span className="text-xs text-muted">{formatDateTime(note.createdAt)}</span>
            </div>
            {note.readAt ? <Badge tone="ok">Read</Badge> : <Button type="button" variant="secondary" onClick={() => read(note.id)}>Mark read</Button>}
          </li>
        ))}
      </ul>
      {(query.data?.data.length ?? 0) === 0 ? <Empty>No notifications yet.</Empty> : null}
    </section>
  );
}

export function AuditPage() {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['audit', search],
    queryFn: () => api<Array<{ id: string; summary: string; action: string; entityType: string; userName: string; createdAt: string; before: unknown; after: unknown }>>(`/audit-logs?pageSize=40&search=${encodeURIComponent(search)}`),
  });
  return (
    <section>
      <PageHeader title="Audit log" description="Who changed what, including the values before and after." />
      <TextInput className="mb-3 max-w-sm" placeholder="Search summaries" value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="overflow-hidden rounded-xl border border-line bg-white">
        {(query.data?.data ?? []).map((row) => (
          <article key={row.id} className="border-b border-line px-4 py-3 last:border-0">
            <button type="button" className="w-full text-left" onClick={() => setOpen(open === row.id ? null : row.id)}>
              <b className="text-sm">{row.summary}</b>
              <span className="mt-1 block text-xs text-muted">{row.userName} · {row.action} · {row.entityType} · {formatDateTime(row.createdAt)}</span>
            </button>
            {open === row.id ? (
              <pre className="mt-3 overflow-auto rounded-lg bg-[#f8fafa] p-3 text-xs">{JSON.stringify({ before: row.before, after: row.after }, null, 2)}</pre>
            ) : null}
          </article>
        ))}
        {(query.data?.data.length ?? 0) === 0 ? <Empty>No audit rows.</Empty> : null}
      </div>
    </section>
  );
}

