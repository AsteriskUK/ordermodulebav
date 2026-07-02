import { AppShell } from '@/components/app-shell';
import { OverviewDashboard } from '@/components/overview-dashboard';
import { RoleGate } from '@/components/role-gate';

export default function OverviewPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager']}>
        <OverviewDashboard />
      </RoleGate>
    </AppShell>
  );
}
