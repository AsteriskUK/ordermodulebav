'use client';

import { useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { AccessConfig, ResourceRule, UserRole, Department, DEPARTMENT_CONFIG } from '@/lib/types';
import {
  ACCESS_RESOURCES, AccessResource, ruleFor, LOCKED_ADMIN_RESOURCES,
} from '@/lib/access';
import { saveAccessControl } from '@/lib/supabase-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldCheck, ChevronDown, Lock, Save } from 'lucide-react';
import { toast } from 'sonner';

const ROLES: { key: UserRole; label: string }[] = [
  { key: 'admin', label: 'Admin' },
  { key: 'manager', label: 'Manager' },
  { key: 'staff', label: 'Staff' },
  { key: 'comms', label: 'Comms' },
];
const ALL_DEPTS = Object.keys(DEPARTMENT_CONFIG) as Department[];

type Draft = Record<string, ResourceRule>;

function buildDraft(cfg: AccessConfig | null): Draft {
  const d: Draft = {};
  for (const r of ACCESS_RESOURCES) {
    const rule = ruleFor(r.id, cfg);
    d[r.id] = {
      roles: Array.from(new Set<UserRole>(['admin', ...rule.roles])), // admin always
      departments: [...rule.departments],
      allowUsers: [...rule.allowUsers],
      denyUsers: [...rule.denyUsers],
    };
  }
  return d;
}

// Group resources by category, preserving registry order.
function groupByCategory(): { category: string; items: AccessResource[] }[] {
  const groups: { category: string; items: AccessResource[] }[] = [];
  for (const r of ACCESS_RESOURCES) {
    let g = groups.find((x) => x.category === r.category);
    if (!g) { g = { category: r.category, items: [] }; groups.push(g); }
    g.items.push(r);
  }
  return groups;
}

export function SettingsPanel() {
  const users = useOrderStore((s) => s.users);
  const accessControl = useOrderStore((s) => s.accessControl);
  const setAccessControl = useOrderStore((s) => s.setAccessControl);

  const [draft, setDraft] = useState<Draft>(() => buildDraft(accessControl));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Re-seed the draft if the shared config arrives/changes after mount (async
  // Supabase sync). Render-time reset avoids an extra effect pass.
  const [seenConfig, setSeenConfig] = useState(accessControl);
  if (accessControl !== seenConfig && !dirty) {
    setSeenConfig(accessControl);
    setDraft(buildDraft(accessControl));
  }

  const nonAdminUsers = users.filter((u) => u.role !== 'admin');

  function edit(id: string, fn: (r: ResourceRule) => ResourceRule) {
    setDirty(true);
    setDraft((prev) => ({ ...prev, [id]: fn(prev[id]) }));
  }

  const toggleRole = (id: string, role: UserRole) => {
    if (role === 'admin') return; // admins are never removable
    edit(id, (r) => ({ ...r, roles: r.roles.includes(role) ? r.roles.filter((x) => x !== role) : [...r.roles, role] }));
  };
  const toggleDept = (id: string, dept: Department) =>
    edit(id, (r) => ({ ...r, departments: r.departments.includes(dept) ? r.departments.filter((x) => x !== dept) : [...r.departments, dept] }));
  // Per-user override cycles: none → allow → deny → none.
  const cycleUser = (id: string, userId: string) =>
    edit(id, (r) => {
      const allowed = r.allowUsers.includes(userId);
      const denied = r.denyUsers.includes(userId);
      const allowUsers = r.allowUsers.filter((x) => x !== userId);
      const denyUsers = r.denyUsers.filter((x) => x !== userId);
      if (!allowed && !denied) return { ...r, allowUsers: [...allowUsers, userId], denyUsers };
      if (allowed) return { ...r, allowUsers, denyUsers: [...denyUsers, userId] };
      return { ...r, allowUsers, denyUsers }; // was denied → back to none
    });

  async function handleSave() {
    setSaving(true);
    const config: AccessConfig = { version: 1, resources: draft };
    setAccessControl(config);
    await saveAccessControl(config);
    setSaving(false);
    setDirty(false);
    setSeenConfig(config);
    toast.success('Permissions saved');
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-blue-500" /> Settings — Access Control
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Grant or restrict pages and features by role, department, or specific user. Admins always keep full access.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving || !dirty} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Save className="h-4 w-4 mr-1.5" />
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>

      {groupByCategory().map(({ category, items }) => (
        <Card key={category}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-700">{category}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100">
              {items.map((res) => {
                const rule = draft[res.id];
                const locked = LOCKED_ADMIN_RESOURCES.includes(res.id);
                const isOpen = expanded === res.id;
                const overrideCount = rule.allowUsers.length + rule.denyUsers.length;
                return (
                  <div key={res.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                          {res.label}
                          {locked && <Lock className="h-3 w-3 text-slate-400" aria-label="Admin always allowed" />}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">{res.id}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {ROLES.map((role) => {
                          const on = rule.roles.includes(role.key);
                          const isAdmin = role.key === 'admin';
                          return (
                            <button
                              key={role.key}
                              onClick={() => toggleRole(res.id, role.key)}
                              disabled={isAdmin}
                              title={isAdmin ? 'Admins always have access' : undefined}
                              className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${
                                on
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                              } ${isAdmin ? 'opacity-70 cursor-default' : ''}`}
                            >
                              {role.label}
                            </button>
                          );
                        })}
                        <button
                          onClick={() => setExpanded(isOpen ? null : res.id)}
                          className="ml-1 text-xs text-slate-500 hover:text-slate-800 flex items-center gap-0.5"
                        >
                          Depts / Users
                          {(rule.departments.length + overrideCount) > 0 && (
                            <span className="ml-0.5 bg-slate-200 text-slate-600 rounded-full px-1.5 text-[10px]">
                              {rule.departments.length + overrideCount}
                            </span>
                          )}
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-3 space-y-3 bg-slate-50 rounded-lg p-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Departments</p>
                          <div className="flex flex-wrap gap-1.5">
                            {ALL_DEPTS.map((d) => {
                              const on = rule.departments.includes(d);
                              return (
                                <button key={d} onClick={() => toggleDept(res.id, d)}
                                  className={`text-xs px-2 py-0.5 rounded-full border ${on ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                                  {DEPARTMENT_CONFIG[d].label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
                            Per-user overrides <span className="normal-case font-normal">(click to cycle: allow → deny → none)</span>
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {nonAdminUsers.length === 0 && <span className="text-xs text-slate-400">No non-admin users.</span>}
                            {nonAdminUsers.map((u) => {
                              const allow = rule.allowUsers.includes(u.id);
                              const deny = rule.denyUsers.includes(u.id);
                              return (
                                <button key={u.id} onClick={() => cycleUser(res.id, u.id)}
                                  className={`text-xs px-2 py-0.5 rounded-full border ${
                                    allow ? 'bg-green-600 text-white border-green-600'
                                    : deny ? 'bg-red-600 text-white border-red-600'
                                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                                  }`}>
                                  {allow ? '✓ ' : deny ? '✕ ' : ''}{u.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-slate-400">
        Changes apply on save and sync to everyone. Enforcement is in the app UI (nav, page redirects, and gated features);
        API endpoints are not yet per-user authenticated.
      </p>
    </div>
  );
}
