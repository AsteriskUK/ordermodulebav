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
  BarChart2,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOrderStore } from '@/lib/store';
import { DEPARTMENT_CONFIG, Department } from '@/lib/types';
import { GlobalSearch } from './global-search';

const ALL_NAV = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, staffVisible: true },
  { name: 'Import Orders', href: '/import', icon: Upload, staffVisible: false },
  { name: 'Batch Shipping', href: '/shipping', icon: Truck, staffVisible: false },
  { name: 'Order Sheet', href: '/orders', icon: ClipboardList, staffVisible: false },
  { name: 'Queue', href: '/packaging', icon: Workflow, staffVisible: true },
  { name: 'Batches', href: '/batches', icon: Package, staffVisible: false },
  { name: 'Returns', href: '/returns', icon: PackageOpen, staffVisible: false },
  { name: 'Reports', href: '/reports', icon: BarChart2, staffVisible: false },
  { name: 'EOD Report', href: '/eod', icon: FileBarChart2, staffVisible: false },
  { name: 'Users & Roles', href: '/users', icon: Users, staffVisible: false },
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const currentUser = users.find((u) => u.id === currentUserId);

  const setCurrentUser = useOrderStore((s) => s.setCurrentUser);
  const isAdminOrManager = currentUser?.role === 'admin' || currentUser?.role === 'manager';
  const navigation = isAdminOrManager
    ? ALL_NAV
    : ALL_NAV.filter((item) => item.staffVisible);
  const userDepts: Department[] = currentUser
    ? (currentUser.departments?.length ? currentUser.departments : [currentUser.department ?? 'management'])
    : [];

  return (
    <aside className={`${
      collapsed ? 'w-16' : 'w-64'
    } bg-slate-900 text-white flex flex-col min-h-screen transition-all duration-300`}>
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
      <nav className="flex-1 p-3 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )}
              title={collapsed ? item.name : undefined}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-slate-700 space-y-3">
        {currentUser ? (
          <>
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-300 truncate">{currentUser.name}</p>
                  <p className="text-xs text-slate-500 capitalize">{currentUser.role}</p>
                </div>
              )}
            </div>
            {!collapsed && !isAdminOrManager && userDepts.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {userDepts.map((d) => (
                  <span key={d} className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${DEPARTMENT_CONFIG[d]?.color ?? ''}`}>
                    {DEPARTMENT_CONFIG[d]?.label ?? d}
                  </span>
                ))}
              </div>
            )}
            {!collapsed && (
              <button
                onClick={() => setCurrentUser(null)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            )}
          </>
        ) : (
          !collapsed && <p className="text-xs text-slate-500">v1.0 — Core Module</p>
        )}
      </div>
    </aside>
  );
}
