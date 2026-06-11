import { AppShell } from '@/components/app-shell';
import { CSVImport } from '@/components/csv-import';
import { RoleGate } from '@/components/role-gate';

export default function ImportPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager']}>
        <CSVImport />
      </RoleGate>
    </AppShell>
  );
}
