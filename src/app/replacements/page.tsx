import { AppShell } from '@/components/app-shell';
import { ReplacementsManager } from '@/components/replacements-manager';
import { RoleGate } from '@/components/role-gate';

export default function ReplacementsPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager']}>
        <ReplacementsManager />
      </RoleGate>
    </AppShell>
  );
}
