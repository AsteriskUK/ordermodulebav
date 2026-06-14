import { AppShell } from '@/components/app-shell';
import { NotesFeed } from '@/components/notes-feed';

export default function NotesPage() {
  return (
    <AppShell>
      <NotesFeed />
    </AppShell>
  );
}
