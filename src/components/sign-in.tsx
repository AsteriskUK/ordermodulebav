'use client';

import { useState, useRef, useEffect } from 'react';
import { useOrderStore } from '@/lib/store';
import { AppUser } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Package, LogIn, ArrowLeft, Lock, AlertTriangle } from 'lucide-react';
import { claimSession } from '@/hooks/use-session-lock';

export function SignIn() {
  const users = useOrderStore((s) => s.users);
  const setCurrentUser = useOrderStore((s) => s.setCurrentUser);

  const [selected, setSelected] = useState<AppUser | null>(null);
  const [query, setQuery] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Set when this profile is already signed in elsewhere — offers a takeover.
  const [conflict, setConflict] = useState<{ user: AppUser; device: string; since: string; pin: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selected) {
      setPin('');
      setError('');
      inputRef.current?.focus();
    }
  }, [selected]);

  // Only one device may be signed in per profile. Claim the session first; if
  // it is live elsewhere, offer to take it over rather than stranding anyone.
  const signIn = async (user: AppUser, enteredPin = '', force = false) => {
    setBusy(true);
    try {
      const blocked = await claimSession(user.id, force);
      if (blocked) {
        // Remember the PIN so the takeover retry can still set the role cookie.
        setConflict({ user, device: blocked.device, since: blocked.since, pin: enteredPin });
        return;
      }
      // Establish the signed, server-verified role cookie (drives the read-only
      // 'viewer' write-block). Best-effort: a failure here doesn't block sign-in.
      try {
        await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, pin: enteredPin }),
        });
      } catch { /* non-blocking */ }
      setConflict(null);
      setCurrentUser(user.id);
    } finally {
      setBusy(false);
    }
  };

  // Browse list excludes admins; typing a query matches everyone (so an admin
  // can find their hidden profile by name). Sorted, case-insensitive contains.
  const q = query.trim().toLowerCase();
  const pickList = users
    .filter((u) => (q ? u.name.toLowerCase().includes(q) : u.role !== 'admin'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleSelect = (user: AppUser) => {
    // Admins sign in directly; everyone else must enter their PIN every time.
    if (user.role === 'admin') {
      signIn(user);
      return;
    }
    setSelected(user);
  };

  const submitPin = () => {
    if (!selected) return;
    if (!selected.pin) {
      setError('No PIN is set for this profile. Ask an admin to set one.');
      return;
    }
    if (pin === selected.pin) {
      signIn(selected, pin);
    } else {
      setError('Incorrect PIN. Try again.');
      setPin('');
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-900 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600">
            <Package className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-lg font-bold text-slate-800">Orders Manager</h1>
          <p className="text-xs text-slate-400">Warehouse Pipeline</p>
        </div>

        {conflict ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <p className="text-sm font-semibold text-slate-800">Already signed in</p>
              <p className="text-xs leading-relaxed text-slate-500">
                <strong>{conflict.user.name}</strong> is signed in on {conflict.device}
                {conflict.since && ` since ${new Date(conflict.since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}.
                Only one device can use a profile at a time.
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-800">
                Signing in here will sign out the other device.
              </p>
            </div>
            <Button className="h-11 w-full" disabled={busy} onClick={() => signIn(conflict.user, conflict.pin, true)}>
              {busy ? 'Signing in…' : 'Sign in here anyway'}
            </Button>
            <button
              onClick={() => { setConflict(null); setSelected(null); setPin(''); }}
              className="flex w-full items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-600"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
          </div>
        ) : !selected ? (
          <div className="space-y-3">
            <p className="text-center text-sm font-medium text-slate-600">Who&apos;s working today?</p>
            {/* Searchable picker. The browse list hides admins; an admin signs in
                by typing their username (they still match the filter). */}
            <div className="relative">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type your name…"
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-100">
                {pickList.map((u) => (
                  <button
                    key={u.id}
                    disabled={busy}
                    onClick={() => handleSelect(u)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{u.name}</p>
                      <p className="text-xs capitalize text-slate-400">{u.role}</p>
                    </div>
                    {u.role === 'admin' ? (
                      <LogIn className="ml-auto h-4 w-4 text-slate-400 shrink-0" />
                    ) : (
                      <Lock className="ml-auto h-3.5 w-3.5 text-slate-400 shrink-0" />
                    )}
                  </button>
                ))}
                {pickList.length === 0 && (
                  <p className="py-6 text-center text-xs text-slate-400">
                    {users.length === 0 ? 'No profiles available.' : 'No match — check the spelling.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                {selected.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{selected.name}</p>
                <p className="text-xs text-slate-400">Enter your PIN to sign in</p>
              </div>
            </div>
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ''));
                setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitPin();
              }}
              placeholder="••••"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-center text-lg tracking-[0.4em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            {error && <p className="text-center text-xs text-red-500">{error}</p>}
            <Button className="h-11 w-full" onClick={submitPin} disabled={!pin || busy}>
              {busy ? 'Signing in…' : 'Sign In'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
