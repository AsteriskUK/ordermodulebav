'use client';

import { useState } from 'react';
import { SettingField, SettingValue } from '@/lib/settings-schema';
import { Input } from '@/components/ui/input';
import { X, Plus, RotateCcw, AlertCircle } from 'lucide-react';

interface Props {
  field: SettingField;
  /** Current effective value (stored override, or the registry default). */
  value: SettingValue;
  /** True when the value differs from the field's default. */
  overridden: boolean;
  error?: string;
  onChange: (value: SettingValue) => void;
  onReset: () => void;
}

/**
 * Renders one setting from the registry. Every input type in the schema is
 * handled here, so adding a setting never means writing UI.
 */
export function SettingFieldRow({ field, value, overridden, error, onChange, onReset }: Props) {
  return (
    <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3">
      {/* Label + help */}
      <div className="sm:w-1/2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-800">{field.label}</span>
          {overridden && (
            <button
              onClick={onReset}
              title="Reset to default"
              className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 hover:bg-amber-100"
            >
              <RotateCcw className="h-2.5 w-2.5" /> Changed
            </button>
          )}
          {field.requiresReload && (
            <span className="text-[10px] text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-1.5 py-0.5">
              Needs reload
            </span>
          )}
        </div>
        {field.help && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{field.help}</p>}
        {field.tokens && field.tokens.length > 0 && (
          <p className="text-[11px] text-slate-400 mt-1">
            Tokens: {field.tokens.map((t) => <code key={t} className="bg-slate-100 rounded px-1 mr-1">{t}</code>)}
          </p>
        )}
        <p className="text-[10px] text-slate-300 font-mono mt-1">{field.key}</p>
      </div>

      {/* Control */}
      <div className="sm:w-1/2 min-w-0">
        <Control field={field} value={value} onChange={onChange} />
        {error && (
          <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
            <AlertCircle className="h-3 w-3 shrink-0" /> {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Control({ field, value, onChange }: { field: SettingField; value: SettingValue; onChange: (v: SettingValue) => void }) {
  switch (field.type) {
    case 'boolean':
      return (
        <button
          role="switch"
          aria-checked={value === true}
          onClick={() => onChange(!(value === true))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${value === true ? 'bg-blue-600' : 'bg-slate-300'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value === true ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      );

    case 'number':
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={String(value ?? '')}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            onChange={(e) => onChange(e.target.value === '' ? field.default : Number(e.target.value))}
            className="w-32"
          />
          {field.unit && <span className="text-xs text-slate-500">{field.unit}</span>}
        </div>
      );

    case 'select':
      return (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full max-w-xs border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );

    case 'multiselect': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {field.options?.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                onClick={() => onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                  on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }

    case 'list':
      return <ListEditor value={Array.isArray(value) ? value : []} unit={field.unit} onChange={onChange} />;

    case 'color':
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={String(value ?? '#000000')}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-14 rounded border border-slate-300 cursor-pointer bg-white p-0.5"
          />
          <Input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="w-28 font-mono text-xs" />
        </div>
      );

    case 'time':
      return (
        <Input type="time" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="w-32" />
      );

    case 'text':
      return (
        <textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          placeholder={field.placeholder}
          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      );

    default:
      return (
        <Input
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** Chip-style editor for free-form string lists (reasons, categories, sizes…). */
function ListEditor({ value, unit, onChange }: { value: string[]; unit?: string; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v || value.includes(v)) { setDraft(''); return; }
    onChange([...value, v]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-xs text-slate-400">Empty</span>}
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 text-xs bg-slate-100 border border-slate-200 rounded-full pl-2.5 pr-1 py-1">
            {v}{unit ? ` ${unit}` : ''}
            <button onClick={() => onChange(value.filter((x) => x !== v))} className="text-slate-400 hover:text-red-500" title="Remove">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Add an item…"
          className="h-8 text-sm max-w-xs"
        />
        <button onClick={add} className="h-8 px-2.5 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 text-xs flex items-center gap-1">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
    </div>
  );
}
