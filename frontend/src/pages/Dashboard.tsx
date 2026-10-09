import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowsLeftRight, Checks, Factory, Scales, ShoppingCart, Truck, Warehouse } from '@phosphor-icons/react';
import { api, can } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatInr, STATUS_LABEL } from '../lib/format';
import { PageHeader } from '../components/ui';

type DashboardData = {
  kpis: { stockValue: string; movementsToday: number; lowStockCount: number; pendingApprovals: number };
  byWarehouse: Array<{ id: string; name: string; finishedValue: string; rawValue: string }>;
  pipeline: Array<{ kind: 'production' | 'shipment'; docNo: string; status: string }>;
  lowStock: Array<{ id: string; sku: string; name: string; unit: string; onHand: string; reorderLevel: string }>;
  activity: Array<{ id: string; summary: string; userName: string; createdAt: string; action: string }>;
};

export function DashboardPage() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/dashboard').then((result) => result.data),
  });
  if (query.isLoading) return <p className="text-sm text-muted">Loading records...</p>;
  if (!query.data) return <p className="text-sm text-danger">Dashboard could not be loaded.</p>;
  const { kpis, byWarehouse, pipeline, activity } = query.data;
  const peak = Math.max(...byWarehouse.map((row) => Number(row.finishedValue) + Number(row.rawValue)), 1);
  const cards = [
    { label: 'Stock value', value: formatInr(kpis.stockValue), note: 'At standard cost', icon: Scales },
    { label: 'Movements today', value: String(kpis.movementsToday), note: 'Ledger rows dated today', icon: Warehouse },
    { label: 'Low stock', value: String(kpis.lowStockCount), note: 'At or below reorder level', icon: Factory },
    { label: 'Pending approvals', value: String(kpis.pendingApprovals), note: 'Waiting for a decision', icon: Checks },
  ];

  return (
    <section>
      <PageHeader title="Today’s stock position" description="Snapshot across every plant on the live ledger.">
        {can(user, 'PURCHASES', 'CREATE') ? (
          <Link to="/purchases/new" className="inline-flex min-h-10 items-center gap-2 rounded-[9px] border border-line bg-white px-3.5 text-[13px] font-bold">
            <ShoppingCart size={16} /> Purchase
          </Link>
        ) : null}
        {can(user, 'PRODUCTION', 'CREATE') ? (
          <Link to="/production/new" className="inline-flex min-h-10 items-center gap-2 rounded-[9px] bg-sea px-3.5 text-[13px] font-bold text-white">
            <Factory size={16} /> New batch
          </Link>
        ) : null}
      </PageHeader>
      <div className="mb-5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.label} className="relative overflow-hidden rounded-[13px] border border-line bg-white p-[18px]">
              <div className="absolute top-3.5 right-3.5 grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-sea-soft text-sea-ink">
                <Icon size={17} />
              </div>
              <div className="mb-2.5 text-xs font-bold text-muted">{card.label}</div>
              <div className="font-mono text-[25px] leading-tight font-semibold tracking-tight">{card.value}</div>
              <div className="mt-2.5 text-xs text-muted">{card.note}</div>
            </article>
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.8fr)]">
        <section className="overflow-hidden rounded-[13px] border border-line bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="m-0 text-[15px]">Finished stock by location</h2>
              <small className="text-muted">Value at standard cost</small>
            </div>
            <Link to="/stock" className="inline-flex min-h-10 items-center rounded-[9px] border border-line px-3 text-[13px] font-bold text-muted">View stock</Link>
          </div>
          <div className="grid gap-4 px-5 py-4">
            {byWarehouse.map((row) => {
              const finished = Number(row.finishedValue);
              const raw = Number(row.rawValue);
              return (
                <div key={row.id} className="grid grid-cols-[110px_1fr_auto] items-center gap-3">
                  <b className="truncate text-[13px]">{row.name.replace(' Cold Store', '').replace(' Dispatch', '').replace(' Plant', '')}</b>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[#f8fafa]">
                    <i className="block h-full rounded-full bg-sea" style={{ width: `${Math.max(4, (finished / peak) * 100)}%` }} />
                  </div>
                  <span className="font-mono text-xs text-muted">{formatInr(row.finishedValue)}</span>
                  <span className="col-start-2 text-[11px] text-muted">Raw {formatInr(raw)}</span>
                </div>
              );
            })}
            {byWarehouse.length === 0 ? <p className="text-sm text-muted">No plants are set up yet.</p> : null}
          </div>
          <div className="flex gap-4 px-5 pb-4 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-sea" /> Finished stock</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[#64b9cc]" /> Raw material balance</span>
          </div>
        </section>
        <section className="overflow-hidden rounded-[13px] border border-line bg-white">
          <div className="border-b border-line px-5 py-4">
            <h2 className="m-0 text-[15px]">Quick actions</h2>
            <small className="text-muted">Post a transaction</small>
          </div>
          <div className="grid grid-cols-3 gap-2.5 p-4">
            <Quick to="/purchases/new" icon={ShoppingCart} label="Purchase" enabled={can(user, 'PURCHASES', 'CREATE')} />
            <Quick to="/transfers/new" icon={ArrowsLeftRight} label="Transfer" enabled={can(user, 'TRANSFERS', 'CREATE')} />
            <Quick to="/shipments/new" icon={Truck} label="Shipment" enabled={can(user, 'SHIPMENTS', 'CREATE')} />
          </div>
        </section>
        <section className="overflow-hidden rounded-[13px] border border-line bg-white">
          <div className="border-b border-line px-5 py-4">
            <h2 className="m-0 text-[15px]">Production & dispatch</h2>
            <small className="text-muted">Current operational view</small>
          </div>
          <div className="grid gap-4 px-5 py-4">
            {pipeline.map((row) => (
              <div key={`${row.kind}-${row.docNo}`} className="grid grid-cols-[110px_1fr_auto] items-center gap-3">
                <b className="truncate font-mono text-[13px]">{row.docNo}</b>
                <div className="h-2.5 overflow-hidden rounded-full bg-[#f8fafa]">
                  <i className={`block h-full rounded-full ${row.kind === 'shipment' ? 'bg-[#64b9cc]' : 'bg-sea'}`} style={{ width: row.status === 'POSTED' ? '100%' : row.status === 'PENDING_APPROVAL' ? '68%' : '42%' }} />
                </div>
                <span className="font-mono text-xs text-muted">{STATUS_LABEL[row.status] ?? row.status}</span>
              </div>
            ))}
            {pipeline.length === 0 ? <p className="text-sm text-muted">No batches or shipments yet.</p> : null}
          </div>
        </section>
        <section className="overflow-hidden rounded-[13px] border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div>
              <h2 className="m-0 text-[15px]">Recent activity</h2>
              <small className="text-muted">Transaction ledger</small>
            </div>
            <Link to="/audit" className="text-xs font-bold text-sea-ink">Audit log</Link>
          </div>
          <ul className="m-0 list-none px-4 py-1">
            {activity.slice(0, 6).map((row) => (
              <li key={row.id} className="grid grid-cols-[32px_1fr] gap-2.5 border-b border-line py-3 last:border-0">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#f8fafa] text-sea"><Scales size={15} /></span>
                <div>
                  <b className="block text-xs">{row.summary}</b>
                  <p className="mt-0.5 mb-0 text-[11px] text-muted">{row.userName} · {formatDateTime(row.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}

function Quick({ to, icon: Icon, label, enabled }: { to: string; icon: typeof ShoppingCart; label: string; enabled: boolean }) {
  if (!enabled) {
    return (
      <span className="grid justify-items-center gap-2 rounded-[10px] border border-line bg-[#f8fafa] px-2 py-3.5 text-[11px] font-bold text-muted opacity-50">
        <Icon size={19} />
        {label}
      </span>
    );
  }
  return (
    <Link to={to} className="grid justify-items-center gap-2 rounded-[10px] border border-line bg-[#f8fafa] px-2 py-3.5 text-[11px] font-bold hover:border-sea">
      <Icon size={19} className="text-sea" />
      {label}
    </Link>
  );
}
