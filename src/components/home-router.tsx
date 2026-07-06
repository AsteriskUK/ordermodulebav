'use client';

import { useOrderStore } from '@/lib/store';
import { can } from '@/lib/access';
import { Dashboard } from './dashboard';
import { StaffDashboard } from './staff-dashboard';

export function HomeRouter() {
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const accessControl = useOrderStore((s) => s.accessControl);
  const currentUser = users.find((u) => u.id === currentUserId) ?? null;

  // AppShell guarantees a signed-in user and redirects anyone who can't access
  // the dashboard (e.g. Comms → Messages) via its central access guard.
  if (!currentUser) return null;
  if (!can(currentUser, '/', accessControl)) return null; // redirecting

  const isAdminOrManager = currentUser.role === 'admin' || currentUser.role === 'manager';
  return isAdminOrManager ? <Dashboard /> : <StaffDashboard />;
}
