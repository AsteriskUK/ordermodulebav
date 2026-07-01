import { AppShell } from '@/components/app-shell';
import { HistoricalOrders } from '@/components/historical-orders';
import { RoleGate } from '@/components/role-gate';

export default function HistoricalPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager']}>
        <HistoricalOrders />
      </RoleGate>
    </AppShell>
  );
}
