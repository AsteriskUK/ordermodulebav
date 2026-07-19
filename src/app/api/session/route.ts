import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-admin';

// ============================================================================
// SINGLE-SESSION LOCK — one active login per user
// ----------------------------------------------------------------------------
// POST   claim     → take the user's session (optionally forcing a takeover)
// PATCH  heartbeat → keep it alive; tells a superseded device to sign out
// DELETE release   → sign out cleanly
//
// Runs through the service role: sessions must not be forgeable from the
// browser. A session that stops heartbeating goes stale after STALE_MS and can
// be claimed freely, so a closed tab never locks anyone out permanently.
// ============================================================================

const STALE_MS = 90_000;  // no heartbeat for this long ⇒ the session is dead

interface SessionRow {
  user_id: string;
  session_id: string;
  device_label: string | null;
  claimed_at: string;
  last_seen_at: string;
}

const isLive = (row: SessionRow | null): boolean =>
  !!row && Date.now() - new Date(row.last_seen_at).getTime() < STALE_MS;

// POST { userId, sessionId, deviceLabel?, force? }
export async function POST(req: Request) {
  const { userId, sessionId, deviceLabel, force } = await req.json().catch(() => ({})) as {
    userId?: string; sessionId?: string; deviceLabel?: string; force?: boolean;
  };
  if (!userId || !sessionId) {
    return NextResponse.json({ error: 'userId and sessionId are required' }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { data: existing, error: readError } = await supabase
    .from('user_sessions').select('*').eq('user_id', userId).maybeSingle();

  // If the table is missing (migration not applied), fail open — signing in
  // must never be blocked by this feature being half-installed.
  if (readError) {
    console.warn('[session] claim read failed, allowing sign-in:', readError.message);
    return NextResponse.json({ ok: true, enforced: false });
  }

  const row = (existing ?? null) as SessionRow | null;
  if (row && row.session_id !== sessionId && isLive(row) && !force) {
    return NextResponse.json({
      ok: false,
      reason: 'already_signed_in',
      device: row.device_label ?? 'another device',
      since: row.claimed_at,
    }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { error: writeError } = await supabase.from('user_sessions').upsert({
    user_id: userId,
    session_id: sessionId,
    device_label: deviceLabel ?? null,
    claimed_at: now,
    last_seen_at: now,
  });
  if (writeError) {
    console.warn('[session] claim write failed, allowing sign-in:', writeError.message);
    return NextResponse.json({ ok: true, enforced: false });
  }
  // supersededDevice tells the UI whether it just kicked someone off.
  return NextResponse.json({
    ok: true,
    enforced: true,
    supersededDevice: row && row.session_id !== sessionId ? (row.device_label ?? 'another device') : null,
  });
}

// PATCH { userId, sessionId, deviceLabel? } → { valid } — false means superseded
export async function PATCH(req: Request) {
  const { userId, sessionId, deviceLabel } = await req.json().catch(() => ({})) as {
    userId?: string; sessionId?: string; deviceLabel?: string;
  };
  if (!userId || !sessionId) return NextResponse.json({ valid: true });

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('user_sessions').select('*').eq('user_id', userId).maybeSingle();
  // Fail open on any infrastructure problem — never sign someone out because
  // the network blipped.
  if (error) return NextResponse.json({ valid: true, enforced: false });

  const row = (data ?? null) as SessionRow | null;
  if (!row) {
    // No row (released or cleared) — re-claim rather than log the user out.
    // Carry the device label through, or a later conflict message degrades to
    // a useless "another device".
    const now = new Date().toISOString();
    await supabase.from('user_sessions').upsert({
      user_id: userId, session_id: sessionId, device_label: deviceLabel ?? null,
      claimed_at: now, last_seen_at: now,
    });
    return NextResponse.json({ valid: true, enforced: true });
  }
  if (row.session_id !== sessionId) {
    return NextResponse.json({ valid: false, takenBy: row.device_label ?? 'another device' });
  }

  // Backfill the label if this row predates it (e.g. created by a heartbeat).
  const patch: Record<string, string> = { last_seen_at: new Date().toISOString() };
  if (!row.device_label && deviceLabel) patch.device_label = deviceLabel;
  await supabase.from('user_sessions')
    .update(patch)
    .eq('user_id', userId).eq('session_id', sessionId);
  return NextResponse.json({ valid: true, enforced: true });
}

// DELETE { userId, sessionId } → release the lock on sign-out
export async function DELETE(req: Request) {
  const { userId, sessionId } = await req.json().catch(() => ({})) as { userId?: string; sessionId?: string };
  if (!userId || !sessionId) return NextResponse.json({ ok: true });
  const supabase = getServiceClient();
  // Only the owning device may release, so a stale tab can't sign out the
  // person who legitimately took the session over.
  await supabase.from('user_sessions').delete().eq('user_id', userId).eq('session_id', sessionId);
  return NextResponse.json({ ok: true });
}
