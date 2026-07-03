import { AppShell } from '@/components/app-shell';
import { MissingItemsManager } from '@/components/missing-items-manager';
import { RoleGate } from '@/components/role-gate';

export default function MissingItemsPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager', 'comms']}>
        <MissingItemsManager />
      </RoleGate>
    </AppShell>
  );
}
