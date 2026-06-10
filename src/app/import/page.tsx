import { AppShell } from '@/components/app-shell';
import { CSVImport } from '@/components/csv-import';

export default function ImportPage() {
  return (
    <AppShell>
      <CSVImport />
    </AppShell>
  );
}
