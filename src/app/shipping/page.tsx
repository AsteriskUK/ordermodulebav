import { AppShell } from '@/components/app-shell';
import { BatchShipping } from '@/components/batch-shipping';
import { RoleGate } from '@/components/role-gate';

export default function ShippingPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager']}>
        <BatchShipping />
      </RoleGate>
    </AppShell>
  );
}
