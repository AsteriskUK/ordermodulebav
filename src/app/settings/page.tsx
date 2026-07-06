import { AppShell } from '@/components/app-shell';
import { SettingsPanel } from '@/components/settings-panel';
import { RoleGate } from '@/components/role-gate';

export default function SettingsPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin']}>
        <SettingsPanel />
      </RoleGate>
    </AppShell>
  );
}
