import { AppShell } from '@/components/app-shell';
import { RoleGate } from '@/components/role-gate';
import { SettingsTabs } from '@/components/settings/settings-tabs';

export default function SettingsPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin']}>
        <SettingsTabs />
      </RoleGate>
    </AppShell>
  );
}
