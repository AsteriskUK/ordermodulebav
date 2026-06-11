import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { OrderTable } from '@/components/order-table';
import { RoleGate } from '@/components/role-gate';

export default function OrdersPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager']}>
        <Suspense fallback={<div className="p-8 text-slate-500">Loading orders...</div>}>
          <OrderTable />
        </Suspense>
      </RoleGate>
    </AppShell>
  );
}
