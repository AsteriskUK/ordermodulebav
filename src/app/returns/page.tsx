import { AppShell } from '@/components/app-shell';
import { ReturnsManager } from '@/components/returns-manager';
import { EbayReturnsList } from '@/components/ebay-returns-list';
import { RoleGate } from '@/components/role-gate';

export default function ReturnsPage() {
  return (
    <AppShell>
      <RoleGate allowedRoles={['admin', 'manager', 'comms']}>
        <div className="space-y-6">
          <ReturnsManager />
          <EbayReturnsList />
        </div>
      </RoleGate>
    </AppShell>
  );
}
