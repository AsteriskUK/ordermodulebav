'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Package,
  Upload,
  ClipboardList,
  Truck,
  LayoutDashboard,
  Workflow,
  FileBarChart2,
  Users,
  PackageOpen,
  PackageMinus,
  BarChart2,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  FilePlus,
  UsersRound,
  Trash,
  RefreshCw,
  MapPin,
  Tag,
  Warehouse,
  History,
  MessageSquareWarning,
  BarChart3,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOrderStore } from '@/lib/store';
import { DEPARTMENT_CONFIG, Department } from '@/lib/types';
import { can } from '@/lib/access';
import { GlobalSearch } from './global-search';

const ALL_NAV = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, staffVisible: true, commsVisible: false },
  { name: 'Overview', href: '/overview', icon: BarChart3, staffVisible: false, commsVisible: false },
  { name: 'Import Orders', href: '/import', icon: Upload, staffVisible: false, commsVisible: false },
  { name: 'Listings', href: '/listings', icon: Tag, staffVisible: false, commsVisible: false },
  { name: 'Inventory', href: '/inventory', icon: Warehouse, staffVisible: false, commsVisible: false },
  { name: 'Create Order', href: '/orders/new', icon: FilePlus, staffVisible: false, commsVisible: false },
  { name: 'Batch Shipping', href: '/shipping', icon: Truck, staffVisible: false, commsVisible: false },
  { name: 'Tracking', href: '/tracking', icon: MapPin, staffVisible: true, commsVisible: true },
  { name: 'Order Sheet', href: '/orders', icon: ClipboardList, staffVisible: false, commsVisible: false },
  { name: 'Historical Orders', href: '/historical', icon: History, staffVisible: false, commsVisible: false },
  { name: 'Queue', href: '/packaging', icon: Workflow, staffVisible: true, commsVisible: false },
  { name: 'Messages', href: '/notes', icon: MessageSquare, staffVisible: true, commsVisible: true },
  { name: 'Feedback', href: '/feedback', icon: MessageSquareWarning, staffVisible: false, commsVisible: true },
  { name: 'Batches', href: '/batches', icon: Package, staffVisible: false, commsVisible: false },
  { name: 'Returns', href: '/returns', icon: PackageOpen, staffVisible: false, commsVisible: true },
  { name: 'Replacements', href: '/replacements', icon: RefreshCw, staffVisible: false, commsVisible: true },
  { name: 'Missing Items', href: '/missing-items', icon: PackageMinus, staffVisible: false, commsVisible: true },
  { name: 'Recently Deleted', href: '/recently-deleted', icon: Trash, staffVisible: false, commsVisible: false },
  { name: 'Reports', href: '/reports', icon: BarChart2, staffVisible: false, commsVisible: false },
  { name: 'EOD Report', href: '/eod', icon: FileBarChart2, staffVisible: false, commsVisible: false },
  { name: 'HR Module', href: '/hr', icon: UsersRound, staffVisible: true, commsVisible: false },
  { name: 'Users & Roles', href: '/users', icon: Users, staffVisible: false, commsVisible: false },
  { name: 'Settings', href: '/settings', icon: Settings, staffVisible: false, commsVisible: false },
];

export function Sidebar({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle: () => void; onNavigate?: () => void }) {
  const pathname = usePathname();
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const currentUser = users.find((u) => u.id === currentUserId);
  const totalNotes = useOrderStore((s) => s.orders.reduce((sum, o) => sum + (o.notes?.length ?? 0), 0));
  const deletedOrdersCount = useOrderStore((s) => s.orders.filter((o) => o.deletedAt).length);
  const missingItemsPending = useOrderStore((s) => s.missingItems.filter((m) => m.status === 'pending').length);

  const setCurrentUser = useOrderStore((s) => s.setCurrentUser);
  const accessControl = useOrderStore((s) => s.accessControl);
  const isAdminOrManager = currentUser?.role === 'admin' || currentUser?.role === 'manager';
  // Nav visibility is governed by the admin-configurable access rules (falls back
  // to per-resource defaults when no config has been saved yet).
  const navigation = ALL_NAV.filter((item) => can(currentUser, item.href, accessControl));
  const userDepts: Department[] = currentUser
    ? (currentUser.departments?.length ? currentUser.departments : [currentUser.department ?? 'management'])
    : [];

  return (
    <aside className={`${
      collapsed ? 'w-16' : 'w-64'
    } bg-slate-900 text-white flex flex-col h-full flex-shrink-0 transition-all duration-300`}>
      <div className="p-4 border-b border-slate-700 flex items-center justify-between">
        {!collapsed && (
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Package className="h-5 w-5 text-blue-400" />
              Orders Manager
            </h1>
            <p className="text-xs text-slate-400 mt-1">Warehouse Pipeline</p>
          </div>
        )}
        <button
          onClick={onToggle}
          className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>
      {isAdminOrManager && !collapsed && (
        <div className="px-3 py-2 border-b border-slate-700">
          <GlobalSearch />
        </div>
      )}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )}
              title={collapsed ? item.name : undefined}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span className="flex-1">{item.name}</span>}
              {!collapsed && item.href === '/notes' && totalNotes > 0 && (
                <span className="ml-auto bg-blue-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                  {totalNotes}
                </span>
              )}
              {!collapsed && item.href === '/missing-items' && missingItemsPending > 0 && (
                <span className="ml-auto bg-orange-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                  {missingItemsPending}
                </span>
              )}
              {!collapsed && item.href === '/recently-deleted' && deletedOrdersCount > 0 && (
                <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                  {deletedOrdersCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {!collapsed && (
        <div className="p-4 border-t border-slate-700">
          <p className="text-xs text-slate-500">v1.0 — Core Module</p>
        </div>
      )}
    </aside>
  );
}
