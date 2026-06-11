import { AppShell } from '@/components/app-shell';
import { UserManagement } from '@/components/user-management';
import { RoleGate } from '@/components/role-gate';

export default function UsersPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin']}>
        <UserManagement />
      </RoleGate>
    </AppShell>
  );
}
