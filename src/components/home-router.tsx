'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOrderStore } from '@/lib/store';
import { Dashboard } from './dashboard';
import { StaffDashboard } from './staff-dashboard';

export function HomeRouter() {
  const router = useRouter();
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);

  const currentUser = users.find((u) => u.id === currentUserId);
  const isComms = currentUser?.role === 'comms';

  // Comms don't work the warehouse pipeline — send them straight to Messages.
  useEffect(() => {
    if (isComms) router.replace('/notes');
  }, [isComms, router]);

  // AppShell guarantees a signed-in user before rendering any page; guard just in case.
  if (!currentUser) return null;
  if (isComms) return null; // redirecting to /notes

  const isAdminOrManager = currentUser.role === 'admin' || currentUser.role === 'manager';
  return isAdminOrManager ? <Dashboard /> : <StaffDashboard />;
}
