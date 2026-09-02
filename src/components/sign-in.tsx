'use client';

import { useState, useRef, useEffect } from 'react';
import { useOrderStore } from '@/lib/store';
import { AppUser } from '@/lib/types';
import { supabase } from '@/lib/supabase-client';
import { Button } from '@/components/ui/button';
import { Package, ArrowLeft, Mail, KeyRound } from 'lucide-react';
import { claimSession } from '@/hooks/use-session-lock';

// Email one-time-code sign-in. There is no list of users and no PIN: each person
// signs in with their own company email, receives a 6-digit code, and enters it.
// The address must already belong to a staff member (or an allow-listed domain)
// or no code is sent — authorization happens server-side in /api/auth/otp/start.
export function SignIn() {
  const setCurrentUser = useOrderStore((s) => s.setCurrentUser);

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const sendCode = async () => {
    const addr = email.trim().toLowerCase();
    if (!addr.includes('@')) { setError('Enter a valid email address.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/otp/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr }),
      });
      if (res.status === 403) {
        setError('This email is not set up for access. Ask an administrator to add you.');
        return;
      }
      if (!res.ok) {
        setError('Could not send the code. Check the address and try again.');
        return;
      }
      setEmail(addr);
      setStep('code');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    const token = code.trim();
    if (token.length < 6) { setError('Enter the 6-digit code from your email.'); return; }
    setBusy(true);
    setError('');
    try {
      // Verify the code with Supabase → establishes the browser session.
      const { data, error: vErr } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      if (vErr || !data.session) {
        setError('That code is incorrect or has expired. Request a new one.');
        setCode('');
        return;
      }
      // Exchange the verified session for an app identity + signed role cookie.
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: data.session.access_token }),
      });
      if (!res.ok) {
        await supabase.auth.signOut().catch(() => {});
        setError('Your account is not authorized for this app. Ask an administrator.');
        return;
      }
      const { user } = await res.json() as { user: AppUser };
      // Ensure the record is present so the app shell can resolve it immediately.
      useOrderStore.setState((s) => (
        s.users.some((u) => u.id === user.id) ? {} : { users: [...s.users, user] }
      ));
      // Single active device per person — this login takes over any other.
      await claimSession(user.id, true).catch(() => {});
      setCurrentUser(user.id);
    } catch {
      setError('Something went wrong verifying the code. Try again.');
    } finally {
      setBusy(false);
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

        {step === 'email' ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
                <Mail className="h-5 w-5 text-blue-600" />
              </div>
              <p className="text-sm font-semibold text-slate-800">Sign in with your work email</p>
              <p className="text-xs leading-relaxed text-slate-500">
                We&apos;ll email you a 6-digit code to sign in. No password needed.
              </p>
            </div>
            <input
              autoFocus
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') sendCode(); }}
              placeholder="you@company.com"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            {error && <p className="text-center text-xs text-red-500">{error}</p>}
            <Button className="h-11 w-full" onClick={sendCode} disabled={!email || busy}>
              {busy ? 'Sending…' : 'Email me a code'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              onClick={() => { setStep('email'); setCode(''); setError(''); }}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Use a different email
            </button>
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
                <KeyRound className="h-5 w-5 text-blue-600" />
              </div>
              <p className="text-sm font-semibold text-slate-800">Enter your code</p>
              <p className="text-xs leading-relaxed text-slate-500">
                We sent a 6-digit code to <strong className="text-slate-700">{email}</strong>.
              </p>
            </div>
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') verifyCode(); }}
              placeholder="••••••"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-center text-lg tracking-[0.5em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            {error && <p className="text-center text-xs text-red-500">{error}</p>}
            <Button className="h-11 w-full" onClick={verifyCode} disabled={code.length < 6 || busy}>
              {busy ? 'Verifying…' : 'Sign In'}
            </Button>
            <button
              onClick={sendCode}
              disabled={busy}
              className="w-full text-center text-xs text-slate-400 hover:text-blue-600 disabled:opacity-50"
            >
              Didn&apos;t get it? Send a new code
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
