'use client';

import { useOrderStore } from '@/lib/store';
import { Dashboard } from './dashboard';
import { StaffDashboard } from './staff-dashboard';
import { Package, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export function HomeRouter() {
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const setCurrentUser = useOrderStore((s) => s.setCurrentUser);
  const router = useRouter();

  const currentUser = users.find((u) => u.id === currentUserId);

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center space-y-6 max-w-sm mx-auto">
        <Package className="h-14 w-14 text-slate-300" />
        <div>
          <h2 className="text-xl font-bold text-slate-700">Who's working today?</h2>
          <p className="text-sm text-slate-400 mt-1">Select your profile to see your personalised dashboard</p>
        </div>
        <div className="w-full space-y-2">
          {users.map((u) => (
            <Button
              key={u.id}
              variant="outline"
              className="w-full justify-start gap-3 h-11"
              onClick={() => setCurrentUser(u.id)}
            >
              <div className="h-7 w-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div className="text-left">
                <p className="text-sm font-medium">{u.name}</p>
                <p className="text-xs text-slate-400 capitalize">{u.role}</p>
              </div>
              <LogIn className="h-4 w-4 ml-auto text-slate-400" />
            </Button>
          ))}
        </div>
        <Button size="sm" variant="ghost" className="text-xs text-slate-400" onClick={() => router.push('/users')}>
          Manage Users
        </Button>
      </div>
    );
  }

  const isAdminOrManager = currentUser.role === 'admin' || currentUser.role === 'manager';
  return isAdminOrManager ? <Dashboard /> : <StaffDashboard />;
}
