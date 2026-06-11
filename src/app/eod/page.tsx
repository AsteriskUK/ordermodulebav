import { AppShell } from '@/components/app-shell';
import { EodReport } from '@/components/eod-report';
import { RoleGate } from '@/components/role-gate';

export default function EodPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager']}>
        <EodReport />
      </RoleGate>
    </AppShell>
  );
}
