import { AppShell } from '@/components/app-shell';
import { BatchList } from '@/components/batch-list';
import { RoleGate } from '@/components/role-gate';

export default function BatchesPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager']}>
        <BatchList />
      </RoleGate>
    </AppShell>
  );
}
