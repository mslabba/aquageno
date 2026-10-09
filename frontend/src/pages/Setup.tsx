import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, can } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatQty, itemTypeLabel } from '../lib/format';
import type { ItemOption, PackingConfig, ReferenceData } from '../lib/types';
import { Badge, Banner, Button, Empty, Field, Modal, PageHeader, SelectInput, Spinner, TextInput } from '../components/ui';

const TABS = [
  ['items', 'Items'],
  ['categories', 'Categories'],
  ['units', 'Units'],
  ['warehouses', 'Warehouses'],
  ['suppliers', 'Suppliers'],
  ['customers', 'Customers'],
  ['boms', 'BOMs'],
  ['packing', 'Packing configs'],
] as const;

type Tab = (typeof TABS)[number][0];

export function MastersPage() {
  const [tab, setTab] = useState<Tab>('items');
  return (
    <section>
      <PageHeader title="Master data" description="Maintain the controlled lists used across purchases, production, stock, transfers, and shipments." />
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === id ? 'bg-nav text-white' : 'border border-line bg-white'}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'items' ? <ItemsPanel /> : null}
      {tab === 'categories' ? <SimplePanel path="/categories" title="Category" fields={[{ key: 'name', label: 'Name' }]} columns={['name']} /> : null}
      {tab === 'units' ? <SimplePanel path="/units" title="Unit" fields={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }]} columns={['code', 'name']} /> : null}
      {tab === 'warehouses' ? <SimplePanel path="/warehouses" title="Warehouse" fields={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'address', label: 'Address' }]} columns={['code', 'name', 'address']} /> : null}
      {tab === 'suppliers' ? <PartyPanel path="/suppliers" title="Supplier" /> : null}
      {tab === 'customers' ? <PartyPanel path="/customers" title="Customer" /> : null}
      {tab === 'boms' ? <BomPanel /> : null}
      {tab === 'packing' ? <PackingPanel /> : null}
    </section>
  );
}

function ItemsPanel() {
  const { user } = useAuth();
  const client = useQueryClient();
  const reference = useQuery({ queryKey: ['reference'], queryFn: () => api<ReferenceData>('/reference').then((r) => r.data) });
  const query = useQuery({
    queryKey: ['items-admin'],
    queryFn: () => api<ItemOption[]>('/items?state=all&pageSize=100').then((result) => result.data),
  });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    id: '',
    sku: '',
    name: '',
    itemType: 'RAW_MATERIAL',
    categoryId: '',
    unitId: '',
    reorderLevel: '0.000',
    standardCost: '0.00',
    isActive: true,
  });

  function edit(row?: ItemOption & { categoryId?: string; unitId?: string; isActive?: boolean; category?: { id?: string }; unit?: { id?: string; code: string } }) {
    setError('');
    setForm({
      id: row?.id ?? '',
      sku: row?.sku ?? '',
      name: row?.name ?? '',
      itemType: row?.itemType ?? 'RAW_MATERIAL',
      categoryId: (row as { categoryId?: string })?.categoryId ?? '',
      unitId: (row as { unitId?: string })?.unitId ?? '',
      reorderLevel: row?.reorderLevel ?? '0.000',
      standardCost: row?.standardCost ?? '0.00',
      isActive: row?.isActive ?? true,
    });
    setOpen(true);
  }

  async function save() {
    setError('');
    const body = { ...form, id: undefined };
    try {
      if (form.id) await api(`/items/${form.id}`, { method: 'PATCH', body });
      else await api('/items', { method: 'POST', body });
      setOpen(false);
      await query.refetch();
      await client.invalidateQueries({ queryKey: ['reference'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the item.');
    }
  }

  async function remove(id: string) {
    await api(`/items/${id}`, { method: 'DELETE' });
    await query.refetch();
  }

  return (
    <div>
      {can(user, 'MASTER_DATA', 'CREATE') ? <Button type="button" className="mb-3" onClick={() => edit()}>Add item</Button> : null}
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        {query.isLoading ? <Spinner /> : null}
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-[#f8fafa] text-left text-[11px] tracking-wide text-muted uppercase">
            <tr>
              <th className="px-3 py-3">SKU</th>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3 text-right">Reorder</th>
              <th className="px-3 py-3 text-right">Cost</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {(query.data ?? []).map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-3 py-3 font-mono">{row.sku}</td>
                <td className="px-3 py-3">{row.name}<span className="mt-1 block text-xs text-muted">{row.unit?.code}</span></td>
                <td className="px-3 py-3">{itemTypeLabel(row.itemType)}</td>
                <td className="px-3 py-3 text-right font-mono">{formatQty(row.reorderLevel)}</td>
                <td className="px-3 py-3 text-right font-mono">{row.standardCost}</td>
                <td className="px-3 py-3 text-right">
                  {can(user, 'MASTER_DATA', 'EDIT') ? <Button type="button" variant="secondary" onClick={() => edit(row as never)}>Edit</Button> : null}
                  {can(user, 'MASTER_DATA', 'DELETE') ? <Button type="button" variant="ghost" className="ml-2" onClick={() => remove(row.id)}>Retire</Button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <Modal title={form.id ? 'Edit item' : 'Add item'} onClose={() => setOpen(false)} footer={<Button type="button" onClick={save}>Save</Button>}>
          {error ? <Banner>{error}</Banner> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="SKU"><TextInput value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} /></Field>
            <Field label="Name"><TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
            <Field label="Type">
              <SelectInput value={form.itemType} onChange={(event) => setForm({ ...form, itemType: event.target.value })}>
                <option value="RAW_MATERIAL">Raw material</option>
                <option value="PACKING_MATERIAL">Packing material</option>
                <option value="FINISHED_GOOD">Finished good</option>
              </SelectInput>
            </Field>
            <Field label="Category">
              <SelectInput value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
                <option value="">Select</option>
                {reference.data?.categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </SelectInput>
            </Field>
            <Field label="Unit">
              <SelectInput value={form.unitId} onChange={(event) => setForm({ ...form, unitId: event.target.value })}>
                <option value="">Select</option>
                {reference.data?.units.map((row) => <option key={row.id} value={row.id}>{row.code}</option>)}
              </SelectInput>
            </Field>
            <Field label="Reorder level"><TextInput value={form.reorderLevel} onChange={(event) => setForm({ ...form, reorderLevel: event.target.value })} /></Field>
            <Field label="Standard cost (INR)"><TextInput value={form.standardCost} onChange={(event) => setForm({ ...form, standardCost: event.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              Active
            </label>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function SimplePanel({ path, title, fields, columns }: { path: string; title: string; fields: Array<{ key: string; label: string }>; columns: string[] }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: [path],
    queryFn: () => api<Array<Record<string, string>>>(`${path}?state=all&pageSize=100`).then((result) => result.data),
  });
  const [row, setRow] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState('');
  async function save() {
    if (!row) return;
    setError('');
    const activeFlag = (row as { isActive?: boolean | string }).isActive;
    const body = { ...row, isActive: activeFlag !== false && activeFlag !== 'false' };
    try {
      if (row.id) await api(`${path}/${row.id}`, { method: 'PATCH', body });
      else await api(path, { method: 'POST', body });
      setRow(null);
      await query.refetch();
      await client.invalidateQueries({ queryKey: ['reference'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed.');
    }
  }
  return (
    <div>
      {can(user, 'MASTER_DATA', 'CREATE') ? (
        <Button type="button" className="mb-3" onClick={() => setRow(Object.fromEntries(fields.map((field) => [field.key, ''])))}>Add {title.toLowerCase()}</Button>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#f8fafa] text-left text-[11px] tracking-wide text-muted uppercase">
            <tr>{columns.map((column) => <th key={column} className="px-3 py-3">{column}</th>)}<th /></tr>
          </thead>
          <tbody>
            {(query.data ?? []).map((record) => (
              <tr key={record.id} className="border-t border-line">
                {columns.map((column) => <td key={column} className="px-3 py-3">{record[column]}</td>)}
                <td className="px-3 py-3 text-right">
                  {can(user, 'MASTER_DATA', 'EDIT') ? <Button type="button" variant="secondary" onClick={() => setRow(record)}>Edit</Button> : null}
                  {can(user, 'MASTER_DATA', 'DELETE') ? <Button type="button" variant="ghost" className="ml-2" onClick={async () => { await api(`${path}/${record.id}`, { method: 'DELETE' }); await query.refetch(); }}>Retire</Button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(query.data ?? []).length === 0 ? <Empty>Nothing here yet.</Empty> : null}
      </div>
      {row ? (
        <Modal title={row.id ? `Edit ${title.toLowerCase()}` : `Add ${title.toLowerCase()}`} onClose={() => setRow(null)} footer={<Button type="button" onClick={save}>Save</Button>}>
          {error ? <Banner>{error}</Banner> : null}
          <div className="grid gap-3">
            {fields.map((field) => (
              <Field key={field.key} label={field.label}>
                <TextInput value={row[field.key] ?? ''} onChange={(event) => setRow({ ...row, [field.key]: event.target.value })} />
              </Field>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function PartyPanel({ path, title }: { path: string; title: string }) {
  return (
    <SimplePanel
      path={path}
      title={title}
      columns={['code', 'name', 'phone']}
      fields={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'contactName', label: 'Contact' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'gstin', label: 'GSTIN' },
        { key: 'address', label: 'Address' },
      ]}
    />
  );
}

function BomPanel() {
  const { user } = useAuth();
  const reference = useQuery({ queryKey: ['reference'], queryFn: () => api<ReferenceData>('/reference').then((r) => r.data) });
  const query = useQuery({
    queryKey: ['boms-admin'],
    queryFn: () => api<Array<{ id: string; name: string; finishedItem: { sku: string; name: string }; lines: Array<{ itemId: string; qtyPerUnit: string; item: { sku: string } }> }>>('/boms?state=all&pageSize=50').then((r) => r.data),
  });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ id: '', name: '', finishedItemId: '', lines: [{ itemId: '', qtyPerUnit: '' }] });

  async function save() {
    setError('');
    const body = { name: form.name, finishedItemId: form.finishedItemId, isActive: true, lines: form.lines };
    try {
      if (form.id) await api(`/boms/${form.id}`, { method: 'PATCH', body });
      else await api('/boms', { method: 'POST', body });
      setOpen(false);
      await query.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the BOM.');
    }
  }

  const components = (reference.data?.items ?? []).filter((item) => item.itemType !== 'FINISHED_GOOD');
  const finished = (reference.data?.items ?? []).filter((item) => item.itemType === 'FINISHED_GOOD');
  return (
    <div>
      {can(user, 'MASTER_DATA', 'CREATE') ? (
        <Button type="button" className="mb-3" onClick={() => { setForm({ id: '', name: '', finishedItemId: '', lines: [{ itemId: '', qtyPerUnit: '' }] }); setOpen(true); }}>Add BOM</Button>
      ) : null}
      <div className="grid gap-3">
        {(query.data ?? []).map((bom) => (
          <article key={bom.id} className="rounded-xl border border-line bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <b>{bom.name}</b>
                <span className="mt-1 block text-xs text-muted">{bom.finishedItem.sku} - {bom.finishedItem.name}</span>
              </div>
              {can(user, 'MASTER_DATA', 'DELETE') ? <Button type="button" variant="ghost" onClick={async () => { await api(`/boms/${bom.id}`, { method: 'DELETE' }); await query.refetch(); }}>Retire</Button> : null}
            </div>
            <ul className="mt-3 mb-0 list-none text-sm">
              {bom.lines.map((line, index) => (
                <li key={index} className="flex justify-between border-t border-line py-2">
                  <span>{line.item.sku}</span>
                  <span className="font-mono">{line.qtyPerUnit} per unit</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      {open ? (
        <Modal title="BOM" onClose={() => setOpen(false)} footer={<Button type="button" onClick={save}>Save</Button>}>
          {error ? <Banner>{error}</Banner> : null}
          <div className="grid gap-3">
            <Field label="Name"><TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
            <Field label="Finished good">
              <SelectInput value={form.finishedItemId} onChange={(event) => setForm({ ...form, finishedItemId: event.target.value })}>
                <option value="">Select</option>
                {finished.map((item) => <option key={item.id} value={item.id}>{item.sku}</option>)}
              </SelectInput>
            </Field>
            {form.lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[1fr_140px_auto] gap-2">
                <SelectInput value={line.itemId} onChange={(event) => {
                  const lines = [...form.lines];
                  lines[index] = { ...line, itemId: event.target.value };
                  setForm({ ...form, lines });
                }}>
                  <option value="">Component</option>
                  {components.map((item) => <option key={item.id} value={item.id}>{item.sku}</option>)}
                </SelectInput>
                <TextInput placeholder="Qty per unit" value={line.qtyPerUnit} onChange={(event) => {
                  const lines = [...form.lines];
                  lines[index] = { ...line, qtyPerUnit: event.target.value };
                  setForm({ ...form, lines });
                }} />
                <Button type="button" variant="ghost" onClick={() => setForm({ ...form, lines: form.lines.filter((_, i) => i !== index) })}>Remove</Button>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={() => setForm({ ...form, lines: [...form.lines, { itemId: '', qtyPerUnit: '' }] })}>Add line</Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

type RoleRow = {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  userCount: number;
  grants: Record<string, string[]>;
};

const MODULES = ['DASHBOARD', 'PURCHASES', 'PRODUCTION', 'STOCK', 'TRANSFERS', 'SHIPMENTS', 'REPORTS', 'MASTER_DATA', 'USERS', 'ROLES', 'APPROVALS'];
const ACTIONS = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE'];
const MODULE_LABEL: Record<string, string> = {
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

function PackingPanel() {
  const { user } = useAuth();
  const reference = useQuery({ queryKey: ['reference'], queryFn: () => api<ReferenceData>('/reference').then((r) => r.data) });
  const query = useQuery({
    queryKey: ['packing-configs'],
    queryFn: () => api<PackingConfig[]>('/packing-configs?state=all&pageSize=200').then((r) => r.data),
  });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ id: '', finishedItemId: '', grade: '', slabWeightKg: '', slabsPerCase: '', tareWeightKg: '0.000', isActive: true });

  const finishedGoods = (reference.data?.items ?? []).filter((item) => item.itemType === 'FINISHED_GOOD');

  function edit(row?: PackingConfig) {
    setError('');
    setForm({
      id: row?.id ?? '',
      finishedItemId: row?.finishedItemId ?? '',
      grade: row?.grade ?? '',
      slabWeightKg: row?.slabWeightKg ?? '',
      slabsPerCase: row ? String(row.slabsPerCase) : '',
      tareWeightKg: row?.tareWeightKg ?? '0.000',
      isActive: row?.isActive ?? true,
    });
    setOpen(true);
  }

  async function save() {
    setError('');
    const body = {
      finishedItemId: form.finishedItemId,
      grade: form.grade,
      slabWeightKg: form.slabWeightKg,
      slabsPerCase: Number(form.slabsPerCase),
      tareWeightKg: form.tareWeightKg || '0.000',
      isActive: form.isActive,
    };
    try {
      if (form.id) await api(`/packing-configs/${form.id}`, { method: 'PATCH', body });
      else await api('/packing-configs', { method: 'POST', body });
      setOpen(false);
      await query.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the packing configuration.');
    }
  }

  async function remove(id: string) {
    try {
      await api(`/packing-configs/${id}`, { method: 'DELETE' });
      await query.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the packing configuration.');
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted">One finished good = one packing configuration. Slab = one packed unit · Case = {`{slabs per case}`} slabs. Stock stays in slabs; cases and loose slabs are derived.</p>
      {can(user, 'MASTER_DATA', 'CREATE') ? <Button type="button" className="mb-3" onClick={() => edit()}>Add packing config</Button> : null}
      {error ? <Banner>{error}</Banner> : null}
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        {query.isLoading ? <Spinner /> : null}
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-[#f8fafa] text-left text-[11px] tracking-wide text-muted uppercase">
            <tr>
              <th className="px-3 py-3">Finished good</th>
              <th className="px-3 py-3">Grade</th>
              <th className="px-3 py-3 text-right">Slab wt (kg)</th>
              <th className="px-3 py-3 text-right">Slabs / case</th>
              <th className="px-3 py-3 text-right">Tare (kg)</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {(query.data ?? []).map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-3 py-3"><b className="font-mono">{row.finishedItem?.sku}</b><span className="mt-1 block text-xs text-muted">{row.finishedItem?.name}</span></td>
                <td className="px-3 py-3 font-mono">{row.grade}</td>
                <td className="px-3 py-3 text-right font-mono">{formatQty(row.slabWeightKg)}</td>
                <td className="px-3 py-3 text-right font-mono">{row.slabsPerCase}</td>
                <td className="px-3 py-3 text-right font-mono">{formatQty(row.tareWeightKg)}</td>
                <td className="px-3 py-3">{row.isActive ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</td>
                <td className="px-3 py-3 text-right">
                  {can(user, 'MASTER_DATA', 'EDIT') ? <Button type="button" variant="ghost" onClick={() => edit(row)}>Edit</Button> : null}
                  {can(user, 'MASTER_DATA', 'DELETE') ? <Button type="button" variant="ghost" onClick={() => remove(row.id)}>Remove</Button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!query.isLoading && (query.data ?? []).length === 0 ? <Empty>No packing configurations yet.</Empty> : null}
      </div>
      {open ? (
        <Modal title={form.id ? 'Edit packing config' : 'Add packing config'} onClose={() => setOpen(false)}>
          {error ? <Banner>{error}</Banner> : null}
          <div className="grid gap-3">
            <Field label="Finished good">
              <SelectInput value={form.finishedItemId} onChange={(e) => setForm({ ...form, finishedItemId: e.target.value })}>
                <option value="">Select</option>
                {finishedGoods.map((item) => <option key={item.id} value={item.id}>{item.sku} — {item.name}</option>)}
              </SelectInput>
            </Field>
            <Field label="Size / grade (e.g. 6/10)">
              <TextInput value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} placeholder="6/10" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Slab weight (kg)">
                <TextInput inputMode="decimal" value={form.slabWeightKg} onChange={(e) => setForm({ ...form, slabWeightKg: e.target.value })} placeholder="1.600" />
              </Field>
              <Field label="Slabs per case">
                <TextInput inputMode="numeric" value={form.slabsPerCase} onChange={(e) => setForm({ ...form, slabsPerCase: e.target.value })} placeholder="6" />
              </Field>
              <Field label="Tare / box (kg)">
                <TextInput inputMode="decimal" value={form.tareWeightKg} onChange={(e) => setForm({ ...form, tareWeightKg: e.target.value })} placeholder="0.000" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="button" onClick={save}>Save</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function RolesPage() {
  const { user } = useAuth();
  const query = useQuery({ queryKey: ['roles'], queryFn: () => api<RoleRow[]>('/roles').then((result) => result.data) });
  const [selected, setSelected] = useState<string>('');
  const [grants, setGrants] = useState<Record<string, string[]>>({});
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const role = query.data?.find((row) => row.id === selected) ?? query.data?.[0];

  function choose(row: RoleRow) {
    setSelected(row.id);
    setGrants(row.grants);
    setName(row.name);
    setDescription(row.description);
    setError('');
  }

  async function createRole() {
    const created = await api<RoleRow>('/roles', { method: 'POST', body: { name: 'New role', description: '' } });
    await query.refetch();
    choose(created.data);
  }

  function toggle(module: string, action: string, base: Record<string, string[]>) {
    const current = new Set(base[module] ?? []);
    if (current.has(action)) current.delete(action);
    else current.add(action);
    setGrants({ ...base, [module]: [...current] });
  }

  async function save() {
    if (!active) return;
    setError('');
    const nextName = selected ? name : active.name;
    const nextDescription = selected ? description : active.description;
    const nextGrants = selected ? grants : active.grants;
    try {
      await api(`/roles/${active.id}`, { method: 'PATCH', body: { name: nextName, description: nextDescription } });
      await api(`/roles/${active.id}/permissions`, { method: 'PUT', body: { grants: nextGrants } });
      await query.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the role.');
    }
  }

  const active = role && selected ? query.data?.find((row) => row.id === selected) ?? role : role;
  const editingId = selected || active?.id;
  const shownGrants = selected ? grants : active?.grants ?? {};
  return (
    <section>
      <PageHeader title="Permissions & approvals" description="Create roles and assign module-level access. Stock and ledger balances stay unchanged until an authorised approver accepts a submission.">
        {can(user, 'ROLES', 'CREATE') ? <Button type="button" onClick={createRole}>New role</Button> : null}
      </PageHeader>
      {error ? <Banner>{error}</Banner> : null}
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="grid content-start gap-2">
          {(query.data ?? []).map((row) => (
            <button key={row.id} type="button" className={`rounded-xl border px-3 py-3 text-left ${editingId === row.id ? 'border-sea bg-sea-soft' : 'border-line bg-white'}`} onClick={() => choose(row)}>
              <b className="text-sm">{row.name}</b>
              <span className="mt-1 block text-xs text-muted">{row.userCount} users{row.isSystem ? ' · system' : ''}</span>
            </button>
          ))}
        </div>
        {active ? (
          <div className="overflow-x-auto rounded-xl border border-line bg-white p-4">
            {can(user, 'ROLES', 'EDIT') ? (
              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <Field label="Name"><TextInput value={selected ? name : active.name} onChange={(event) => { setSelected(active.id); setName(event.target.value); setGrants(active.grants); }} /></Field>
                <Field label="Description"><TextInput value={selected ? description : active.description} onChange={(event) => { setSelected(active.id); setDescription(event.target.value); setGrants(active.grants); }} /></Field>
              </div>
            ) : null}
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-left">Module</th>
                  {ACTIONS.map((action) => <th key={action} className="px-2 py-2 text-center text-[11px]">{action}</th>)}
                </tr>
              </thead>
              <tbody>
                {MODULES.map((module) => (
                  <tr key={module} className="border-t border-line">
                    <td className="px-2 py-2 font-semibold">{MODULE_LABEL[module]}</td>
                    {ACTIONS.map((action) => {
                      const locked = active.isSystem && (module === 'USERS' || module === 'ROLES');
                      const checked = (shownGrants[module] ?? []).includes(action);
                      return (
                        <td key={action} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={locked ? true : checked}
                            disabled={!can(user, 'ROLES', 'EDIT') || locked}
                            onChange={() => {
                              const base = selected ? grants : active.grants;
                              if (!selected) {
                                setSelected(active.id);
                                setName(active.name);
                                setDescription(active.description);
                              }
                              toggle(module, action, base);
                            }}
                            aria-label={`${MODULE_LABEL[module]} ${action}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {can(user, 'ROLES', 'EDIT') ? <Button type="button" className="mt-4" onClick={save}>Save role</Button> : null}
            {active.isSystem ? <p className="mt-3 text-xs text-muted">The system administrator role always keeps Users and Roles access, so the plant cannot be locked out.</p> : null}
          </div>
        ) : <Spinner />}
      </div>
    </section>
  );
}

export function UsersPage() {
  const { user } = useAuth();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<RoleRow[]>('/roles').then((r) => r.data) });
  const query = useQuery({
    queryKey: ['users'],
    queryFn: () => api<Array<{ id: string; name: string; email: string; isActive: boolean; mustChangePassword: boolean; role: { id: string; name: string } }>>('/users?pageSize=100').then((r) => r.data),
  });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ id: '', name: '', email: '', password: '', roleId: '', isActive: true });

  async function save() {
    setError('');
    try {
      if (form.id) {
        await api(`/users/${form.id}`, {
          method: 'PATCH',
          body: { name: form.name, roleId: form.roleId, isActive: form.isActive, ...(form.password ? { password: form.password, mustChangePassword: true } : {}) },
        });
      } else {
        await api('/users', { method: 'POST', body: { name: form.name, email: form.email, password: form.password, roleId: form.roleId, mustChangePassword: true } });
      }
      setOpen(false);
      await query.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the user.');
    }
  }

  return (
    <section>
      <PageHeader title="Users" description="Each person has one role. A new password forces a change at the next sign-in.">
        {can(user, 'USERS', 'CREATE') ? (
          <Button type="button" onClick={() => { setForm({ id: '', name: '', email: '', password: '', roleId: roles.data?.[0]?.id ?? '', isActive: true }); setOpen(true); }}>Add user</Button>
        ) : null}
      </PageHeader>
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-[#f8fafa] text-left text-[11px] tracking-wide text-muted uppercase">
            <tr>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Email</th>
              <th className="px-3 py-3">Role</th>
              <th className="px-3 py-3">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(query.data ?? []).map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-3 py-3 font-semibold">{row.name}</td>
                <td className="px-3 py-3">{row.email}</td>
                <td className="px-3 py-3">{row.role.name}</td>
                <td className="px-3 py-3">{row.isActive ? <Badge tone="ok">Active</Badge> : <Badge tone="danger">Inactive</Badge>}</td>
                <td className="px-3 py-3 text-right">
                  {can(user, 'USERS', 'EDIT') ? (
                    <Button type="button" variant="secondary" onClick={() => { setForm({ id: row.id, name: row.name, email: row.email, password: '', roleId: row.role.id, isActive: row.isActive }); setOpen(true); }}>Edit</Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(query.data ?? []).length === 0 ? <Empty>No users.</Empty> : null}
      </div>
      {open ? (
        <Modal title={form.id ? 'Edit user' : 'Add user'} onClose={() => setOpen(false)} footer={<Button type="button" onClick={save}>Save</Button>}>
          {error ? <Banner>{error}</Banner> : null}
          <div className="grid gap-3">
            <Field label="Name"><TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
            {form.id ? null : <Field label="Email"><TextInput value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>}
            <Field label={form.id ? 'New password (optional)' : 'Temporary password'}>
              <TextInput type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            </Field>
            <Field label="Role">
              <SelectInput value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })}>
                {(roles.data ?? []).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </SelectInput>
            </Field>
            {form.id ? (
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
                Active
              </label>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
