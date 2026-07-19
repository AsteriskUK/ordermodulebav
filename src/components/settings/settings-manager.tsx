'use client';

import { useMemo, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import {
  SETTINGS_SCHEMA, SETTING_DEFAULTS, SettingValue, validateSetting, SettingsGroup,
} from '@/lib/settings-schema';
import { SettingsValues, sanitiseSettings } from '@/lib/settings';
import { saveAppSettings, recordSettingsAudit } from '@/lib/supabase-store';
import { SettingFieldRow } from './setting-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Building2, Workflow, Truck, Printer, MessageSquare, PackageOpen, Boxes,
  BarChart3, Palette, Database, Save, RotateCcw, Search, Download, Upload, SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';

const ICONS: Record<string, typeof Building2> = {
  Building2, Workflow, Truck, Printer, MessageSquare, PackageOpen, Boxes, BarChart3, Palette, Database,
};

/**
 * The settings module. Everything on screen is generated from SETTINGS_SCHEMA —
 * adding a setting to the registry makes it appear here automatically.
 */
export function SettingsManager() {
  const storedSettings = useOrderStore((s) => s.appSettings);
  const setAppSettings = useOrderStore((s) => s.setAppSettings);
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const currentUser = users.find((u) => u.id === currentUserId);

  const [activeGroup, setActiveGroup] = useState(SETTINGS_SCHEMA[0].id);
  const [draft, setDraft] = useState<SettingsValues>(() => ({ ...(storedSettings ?? {}) }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [search, setSearch] = useState('');

  // Re-seed from the shared config when it arrives/changes, unless mid-edit.
  const [seen, setSeen] = useState(storedSettings);
  if (storedSettings !== seen && !dirty) {
    setSeen(storedSettings);
    setDraft({ ...(storedSettings ?? {}) });
  }

  /** Effective value: draft override → registry default. */
  const valueOf = (key: string): SettingValue => (key in draft ? draft[key] : SETTING_DEFAULTS[key]);
  const isOverridden = (key: string) =>
    key in draft && JSON.stringify(draft[key]) !== JSON.stringify(SETTING_DEFAULTS[key]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    for (const [key, value] of Object.entries(draft)) {
      const err = validateSetting(key, value);
      if (err) e[key] = err;
    }
    return e;
  }, [draft]);

  const changedCount = useMemo(
    () => Object.keys(draft).filter((k) => isOverridden(k)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft],
  );

  function setValue(key: string, value: SettingValue) {
    setDirty(true);
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function resetValue(key: string) {
    setDirty(true);
    setDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleSave() {
    if (Object.keys(errors).length > 0) {
      toast.error('Fix the highlighted values before saving');
      return;
    }
    setSaving(true);
    try {
      // Only genuine overrides are persisted, so changed defaults still reach
      // existing installs and the exported document stays readable.
      const { values } = sanitiseSettings(draft);
      const before = storedSettings ?? {};
      await saveAppSettings(values);
      setAppSettings(values);

      // Audit every key that actually changed (best-effort).
      const touched = new Set([...Object.keys(before), ...Object.keys(values)]);
      const entries = [...touched]
        .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(values[k]))
        .map((k) => ({ key: k, from: before[k] ?? null, to: values[k] ?? null }));
      recordSettingsAudit(entries, { id: currentUser?.id, name: currentUser?.name }).catch(() => {});

      setDraft(values);
      setSeen(values);
      setDirty(false);
      toast.success(`Settings saved${entries.length ? ` — ${entries.length} change${entries.length !== 1 ? 's' : ''}` : ''}`);
    } catch (e) {
      toast.error(`Could not save settings: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setDraft({ ...(storedSettings ?? {}) });
    setDirty(false);
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(sanitiseSettings(draft).values, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Settings exported');
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as SettingsValues;
        const { values, errors: bad } = sanitiseSettings(parsed);
        setDraft(values);
        setDirty(true);
        const skipped = Object.keys(bad).length;
        toast.success(`Imported ${Object.keys(values).length} setting${Object.keys(values).length !== 1 ? 's' : ''}${skipped ? ` — ${skipped} skipped as invalid` : ''}. Review, then Save.`);
      } catch {
        toast.error('That file is not valid settings JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // Search jumps across every group; otherwise show the selected group.
  const query = search.trim().toLowerCase();
  const visibleGroups: SettingsGroup[] = useMemo(() => {
    const groups = query ? SETTINGS_SCHEMA : SETTINGS_SCHEMA.filter((g) => g.id === activeGroup);
    return groups
      .map((g) => ({
        ...g,
        sections: g.sections
          .map((s) => ({
            ...s,
            fields: s.fields.filter((f) => {
              if (!showAdvanced && f.advanced) return false;
              if (!query) return true;
              return (
                f.label.toLowerCase().includes(query) ||
                f.key.toLowerCase().includes(query) ||
                (f.help ?? '').toLowerCase().includes(query)
              );
            }),
          }))
          .filter((s) => s.fields.length > 0),
      }))
      .filter((g) => g.sections.length > 0);
  }, [query, activeGroup, showAdvanced]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <SlidersHorizontal className="h-6 w-6 text-blue-500" /> Settings
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Configure how the app behaves. Anything left untouched uses its built-in default.
            {changedCount > 0 && <span className="text-amber-700"> {changedCount} customised.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="file" accept="application/json" id="settings-import" className="hidden" onChange={handleImport} />
          <Button variant="outline" size="sm" onClick={() => document.getElementById('settings-import')?.click()} title="Import settings JSON">
            <Upload className="h-4 w-4 mr-1.5" /> Import
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} title="Export settings JSON">
            <Download className="h-4 w-4 mr-1.5" /> Export
          </Button>
          {dirty && (
            <Button variant="outline" size="sm" onClick={handleDiscard}>
              <RotateCcw className="h-4 w-4 mr-1.5" /> Discard
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving || !dirty} className="bg-blue-600 hover:bg-blue-700 text-white">
            <Save className="h-4 w-4 mr-1.5" />
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>
      </div>

      {/* Search + advanced toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all settings…"
            className="w-full border border-slate-300 rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
          <input type="checkbox" checked={showAdvanced} onChange={(e) => setShowAdvanced(e.target.checked)} className="h-3.5 w-3.5 accent-slate-700" />
          Show advanced
        </label>
      </div>

      <div className="flex gap-4 items-start">
        {/* Group tabs */}
        {!query && (
          <nav className="w-52 shrink-0 space-y-0.5 hidden md:block">
            {SETTINGS_SCHEMA.map((g) => {
              const Icon = ICONS[g.icon] ?? SlidersHorizontal;
              const count = g.sections.flatMap((s) => s.fields).filter((f) => isOverridden(f.key)).length;
              return (
                <button
                  key={g.id}
                  onClick={() => setActiveGroup(g.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                    activeGroup === g.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{g.label}</span>
                  {count > 0 && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5">{count}</span>
                  )}
                </button>
              );
            })}
          </nav>
        )}

        {/* Fields */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Mobile group picker */}
          {!query && (
            <select
              value={activeGroup}
              onChange={(e) => setActiveGroup(e.target.value)}
              className="md:hidden w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
            >
              {SETTINGS_SCHEMA.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          )}

          {visibleGroups.length === 0 && (
            <p className="text-sm text-slate-400 py-12 text-center">No settings match &ldquo;{search}&rdquo;.</p>
          )}

          {visibleGroups.map((group) => (
            <div key={group.id} className="space-y-4">
              {query && <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>}
              {!query && group.description && <p className="text-sm text-slate-500">{group.description}</p>}
              {group.sections.map((section) => (
                <Card key={section.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-slate-700">{section.label}</CardTitle>
                    {section.description && <p className="text-xs text-slate-500 mt-0.5">{section.description}</p>}
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y divide-slate-100">
                      {section.fields.map((field) => (
                        <SettingFieldRow
                          key={field.key}
                          field={field}
                          value={valueOf(field.key)}
                          overridden={isOverridden(field.key)}
                          error={errors[field.key]}
                          onChange={(v) => setValue(field.key, v)}
                          onReset={() => resetValue(field.key)}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
