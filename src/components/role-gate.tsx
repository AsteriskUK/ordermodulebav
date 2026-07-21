'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOrderStore } from '@/lib/store';
import { UserRole } from '@/lib/types';
import { ShieldOff } from 'lucide-react';

interface RoleGateProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
  redirectTo?: string;
}

export function RoleGate({ allowedRoles, children, redirectTo = '/' }: RoleGateProps) {
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const router = useRouter();

  const currentUser = users.find((u) => u.id === currentUserId);
  // Read-only viewers may view any gated page (e.g. Settings, Users) — every
  // write is blocked server-side, so read-only access to admin pages is safe
  // and matches "see everything, change nothing".
  const allowed = currentUser && (currentUser.role === 'viewer' || allowedRoles.includes(currentUser.role));

  useEffect(() => {
    if (currentUser && !allowed) {
      router.replace(redirectTo);
    }
  }, [currentUser, allowed, router, redirectTo]);

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ShieldOff className="h-10 w-10 text-slate-300 mb-3" />
        <p className="text-slate-500 text-sm">Sign in to access this page.</p>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ShieldOff className="h-10 w-10 text-red-300 mb-3" />
        <h3 className="text-base font-semibold text-slate-700">Access Denied</h3>
        <p className="text-sm text-slate-400 mt-1">You don't have permission to view this page.</p>
      </div>
    );
  }

  return <>{children}</>;
}
