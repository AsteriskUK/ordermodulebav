import { AppShell } from '@/components/app-shell';
import { Reports } from '@/components/reports';
import { RoleGate } from '@/components/role-gate';

export default function ReportsPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager']}>
        <Reports />
      </RoleGate>
    </AppShell>
  );
}
