'use client';

import { useOrderStore } from '@/lib/store';
import { Dashboard } from './dashboard';
import { StaffDashboard } from './staff-dashboard';

export function HomeRouter() {
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);

  const currentUser = users.find((u) => u.id === currentUserId);

  // AppShell guarantees a signed-in user before rendering any page; guard just in case.
  if (!currentUser) return null;

  const isAdminOrManager = currentUser.role === 'admin' || currentUser.role === 'manager';
  return isAdminOrManager ? <Dashboard /> : <StaffDashboard />;
}
