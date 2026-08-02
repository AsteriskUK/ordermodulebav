'use client';

import { useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { useSettingString } from '@/hooks/use-settings';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PenLine } from 'lucide-react';
import { toast } from 'sonner';

/** Per-user reply signature editor — each staff member signs off in their own
 *  name. Falls back to the global signature (Settings → Messaging) when blank. */
export function SignatureDialog({ onClose }: { onClose: () => void }) {
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const currentUser = useOrderStore((s) => s.users.find((u) => u.id === s.currentUserId));
  const updateUser = useOrderStore((s) => s.updateUser);
  const globalSignature = useSettingString('messaging.signature');

  const [value, setValue] = useState(currentUser?.signature ?? '');
  const [saving, setSaving] = useState(false);

  const save = () => {
    if (!currentUserId) return;
    setSaving(true);
    updateUser(currentUserId, { signature: value.trim() || undefined });
    toast.success(value.trim() ? 'Your reply signature was saved' : 'Signature cleared — using the shared default');
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PenLine className="h-4 w-4" /> My reply signature</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <p className="text-xs text-slate-500">
            Added to the end of your messages to buyers (eBay, Amazon &amp; Back Market). Leave blank to use the shared default.
          </p>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            placeholder={globalSignature ? `Shared default:\n${globalSignature}` : 'e.g.\nKind regards,\nSarah\nBirmingham AV'}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {value.trim() && (
            <div className="rounded-md bg-slate-50 border border-slate-200 p-2 text-xs text-slate-600 whitespace-pre-wrap">
              <span className="text-slate-400">Preview:</span>{'\n'}{value.trim()}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>Save signature</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
