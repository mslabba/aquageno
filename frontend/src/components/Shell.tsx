import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowsLeftRight,
  Basket,
  Bell,
  ChartLine,
  Checks,
  Database,
  Factory,
  List,
  Scales,
  Scroll,
  ShieldCheck,
  SignOut,
  SquaresFour,
  Truck,
  Users,
  Warehouse,
  X,
} from '@phosphor-icons/react';
import { api, can } from '../lib/api';
import { logout, useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Dashboard', module: 'DASHBOARD', icon: SquaresFour, end: true },
  { to: '/purchases', label: 'Purchases', module: 'PURCHASES', icon: Basket },
  { to: '/production', label: 'Production', module: 'PRODUCTION', icon: Factory },
  { to: '/stock', label: 'Stock', module: 'STOCK', icon: Warehouse },
  { to: '/transfers', label: 'Transfers', module: 'TRANSFERS', icon: ArrowsLeftRight },
  { to: '/shipments', label: 'Shipments', module: 'SHIPMENTS', icon: Truck },
  { to: '/reports', label: 'Reports', module: 'REPORTS', icon: ChartLine },
  { to: '/master', label: 'Master Data', module: 'MASTER_DATA', icon: Database },
  { to: '/roles', label: 'Permissions', module: 'ROLES', icon: ShieldCheck },
  { to: '/approvals', label: 'Approvals', module: 'APPROVALS', icon: Checks },
  { to: '/adjustments', label: 'Adjustments', module: 'STOCK', icon: Scales },
  { to: '/users', label: 'Users', module: 'USERS', icon: Users },
  { to: '/audit', label: 'Audit log', module: 'DASHBOARD', icon: Scroll },
];

const CRUMBS: Record<string, string> = {
  purchases: 'Purchases',
  production: 'Production',
  stock: 'Stock',
  transfers: 'Transfers',
  shipments: 'Shipments',
  adjustments: 'Adjustments',
  approvals: 'Approvals',
  reports: 'Reports',
  master: 'Master Data',
  users: 'Users',
  roles: 'Permissions',
  audit: 'Audit log',
  notifications: 'Notifications',
  'change-password': 'Password',
};

export function Shell() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const unread = useQuery({
    queryKey: ['unread'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count').then((result) => result.data.count),
    refetchInterval: 30000,
  });

  async function signOut() {
    await logout();
    setUser(null);
    navigate('/login');
  }

  const links = NAV.filter((item) => can(user, item.module, 'VIEW'));
  const section = location.pathname.split('/').filter(Boolean)[0] ?? '';
  const crumb = CRUMBS[section] ?? 'Dashboard';
  const initials = user?.name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      {open ? <button className="fixed inset-0 z-30 bg-[#041416]/50 lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-nav px-4 pt-7 pb-5 text-[#e5f5f3] transition-transform lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="border-b border-white/15 px-3 pb-5">
          <strong className="block text-[15px]">Aquageno Exim</strong>
          <small className="mt-1 block text-xs text-[#9bc0be]">All plants · live ledger</small>
        </div>
        <nav className="mt-4 grid gap-1 overflow-auto">
          {links.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-sm font-semibold ${isActive ? 'bg-[#e4f5f2] text-[#083a3b]' : 'text-[#b9d1cf] hover:bg-white/6 hover:text-white'}`
                }
              >
                <Icon size={18} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-white/15 px-3 pt-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-[#2a686d] text-xs font-bold">{initials}</div>
            <div className="min-w-0">
              <b className="block truncate text-[13px]">{user?.name}</b>
              <small className="mt-0.5 block text-[11px] text-[#9bc0be]">{user?.role.name}</small>
            </div>
          </div>
          <button className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-[#9bc0be] hover:text-white" onClick={signOut} type="button">
            <SignOut size={14} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-[74px] items-center justify-between border-b border-line bg-white/95 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button className="inline-flex h-10 items-center gap-2 rounded-[9px] border border-line bg-white px-2.5 text-sm font-bold lg:hidden" onClick={() => setOpen((value) => !value)} type="button" aria-label="Open navigation">
              {open ? <X size={18} /> : <List size={18} />}
              <span>Menu</span>
            </button>
            <div className="text-[13px] text-muted">
              Operations <span className="px-1">/</span> <strong className="font-semibold text-ink">{crumb}</strong>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="hidden items-center gap-2 rounded-[9px] border border-line bg-[#f8fafa] px-3 py-2 text-[13px] font-semibold sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[#25b889] shadow-[0_0_0_4px_rgba(37,184,137,0.16)]" />
              All locations
            </div>
            <NavLink to="/notifications" className="relative grid h-[38px] w-[38px] place-items-center rounded-[9px] border border-line bg-white" aria-label="Notifications">
              <Bell size={18} />
              {unread.data ? (
                <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-sea px-1 text-[10px] font-bold text-white">
                  {unread.data}
                </span>
              ) : null}
            </NavLink>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 py-7 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
