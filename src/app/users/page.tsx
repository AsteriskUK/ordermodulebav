import { AppShell } from '@/components/app-shell';
import { UserManagement } from '@/components/user-management';

export default function UsersPage() {
  return (
    <AppShell>
      <UserManagement />
    </AppShell>
  );
}
