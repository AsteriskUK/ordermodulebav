'use client';

import { useState } from 'react';
import { SettingsManager } from './settings-manager';
import { SettingsPanel } from '@/components/settings-panel';
import { PrinterSettings } from '@/components/printer-settings';
import { SettingsAuditLog } from './settings-audit-log';
import { SlidersHorizontal, ShieldCheck, Printer, History } from 'lucide-react';

type Tab = 'app' | 'access' | 'printers' | 'audit';

const TABS: { key: Tab; label: string; icon: typeof SlidersHorizontal }[] = [
  { key: 'app', label: 'Configuration', icon: SlidersHorizontal },
  { key: 'access', label: 'Access Control', icon: ShieldCheck },
  { key: 'printers', label: 'Printers', icon: Printer },
  { key: 'audit', label: 'Change History', icon: History },
];

export function SettingsTabs() {
  const [tab, setTab] = useState<Tab>('app');

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${
              tab === key ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'app' && <SettingsManager />}
      {tab === 'access' && <SettingsPanel />}
      {tab === 'printers' && <PrinterSettings />}
      {tab === 'audit' && <SettingsAuditLog />}
    </div>
  );
}
