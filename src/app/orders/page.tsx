import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { OrderTable } from '@/components/order-table';

export default function OrdersPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="p-8 text-slate-500">Loading orders...</div>}>
        <OrderTable />
      </Suspense>
    </AppShell>
  );
}
