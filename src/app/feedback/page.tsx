import { AppShell } from '@/components/app-shell';
import { FeedbackList } from '@/components/feedback-list';
import { RoleGate } from '@/components/role-gate';

export default function FeedbackPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager', 'comms']}>
        <FeedbackList />
      </RoleGate>
    </AppShell>
  );
}
