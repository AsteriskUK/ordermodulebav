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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOrderStore } from '@/lib/store';
import { GlobalSearch } from './global-search';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Import Orders', href: '/import', icon: Upload },
  { name: 'Order Sheet', href: '/orders', icon: ClipboardList },
  { name: 'Packaging', href: '/packaging', icon: Workflow },
  { name: 'Batch Shipping', href: '/shipping', icon: Truck },
  { name: 'Batches', href: '/batches', icon: Package },
  { name: 'Returns', href: '/returns', icon: PackageOpen },
  { name: 'Reports', href: '/reports', icon: BarChart2 },
  { name: 'EOD Report', href: '/eod', icon: FileBarChart2 },
  { name: 'Users & Roles', href: '/users', icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const currentUser = users.find((u) => u.id === currentUserId);

  return (
    <aside className="w-64 bg-slate-900 text-white flex flex-col min-h-screen">
      <div className="p-4 border-b border-slate-700">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Package className="h-5 w-5 text-blue-400" />
          Orders Manager
        </h1>
        <p className="text-xs text-slate-400 mt-1">Warehouse Pipeline</p>
      </div>
      <div className="px-3 py-2 border-b border-slate-700">
        <GlobalSearch />
      </div>
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
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-slate-700">
        {currentUser ? (
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">
              {currentUser.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-300">{currentUser.name}</p>
              <p className="text-xs text-slate-500 capitalize">{currentUser.role}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">v1.0 — Core Module</p>
        )}
      </div>
    </aside>
  );
}
