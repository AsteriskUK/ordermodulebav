'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { SETTING_FIELD_BY_KEY } from '@/lib/settings-schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { History, RefreshCw } from 'lucide-react';

interface AuditRow {
  id: string;
  setting_key: string;
  old_value: string | null;
  new_value: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

/** Pretty-print a stored JSON value; null means "back to default". */
function display(raw: string | null): string {
  if (raw === null) return 'default';
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.length ? v.join(', ') : 'empty';
    if (typeof v === 'boolean') return v ? 'on' : 'off';
    return String(v);
  } catch {
    return raw;
  }
}

export function SettingsAuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('settings_audit')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(200);
    // The table only exists once the migration is applied.
    if (error) setUnavailable(true);
    else setRows((data ?? []) as AuditRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm text-slate-700 flex items-center gap-2">
          <History className="h-4 w-4" /> Change history
        </CardTitle>
        <button onClick={load} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            Change history is not set up yet — apply <code className="bg-slate-100 rounded px-1">supabase/migrations/settings_audit.sql</code>.
            Settings still save normally without it.
          </p>
        ) : loading ? (
          <p className="text-sm text-slate-400 py-6 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">No settings have been changed yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 -mx-6">
            {rows.map((r) => (
              <div key={r.id} className="px-6 py-2.5 text-sm flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium text-slate-800">
                  {SETTING_FIELD_BY_KEY[r.setting_key]?.label ?? r.setting_key}
                </span>
                <span className="text-slate-400 line-through">{display(r.old_value)}</span>
                <span className="text-slate-400">→</span>
                <span className="text-slate-700 font-medium">{display(r.new_value)}</span>
                <span className="text-xs text-slate-400 ml-auto">
                  {r.changed_by_name ?? 'Unknown'} · {new Date(r.changed_at).toLocaleString('en-GB')}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
