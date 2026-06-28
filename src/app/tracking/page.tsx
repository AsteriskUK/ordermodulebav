import { AppShell } from '@/components/app-shell';
import { TrackingMonitor } from '@/components/tracking-monitor';
import { RoleGate } from '@/components/role-gate';

export default function TrackingPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager', 'staff']}>
        <TrackingMonitor />
      </RoleGate>
    </AppShell>
  );
}
