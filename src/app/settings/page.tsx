import { AppShell } from '@/components/app-shell';
import { SettingsPanel } from '@/components/settings-panel';
import { PrinterSettings } from '@/components/printer-settings';
import { RoleGate } from '@/components/role-gate';

export default function SettingsPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin']}>
        <div className="space-y-4">
          <PrinterSettings />
          <SettingsPanel />
        </div>
      </RoleGate>
    </AppShell>
  );
}
