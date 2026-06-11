import { AppShell } from '@/components/app-shell';
import { ReturnsManager } from '@/components/returns-manager';
import { RoleGate } from '@/components/role-gate';

export default function ReturnsPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager']}>
        <ReturnsManager />
      </RoleGate>
    </AppShell>
  );
}
