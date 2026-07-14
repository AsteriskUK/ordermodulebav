'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { EodScheduler } from './eod-scheduler';
import { PanelLeftClose, PanelLeftOpen, LogOut, ChevronDown, Check, Bell, MessageSquare, ChevronRight, ThumbsDown, ThumbsUp } from 'lucide-react';
import { supabase } from '@/lib/supabase-client';
import { Button } from './ui/button';
import { useSupabaseSync } from '@/hooks/use-supabase-sync';
import { useAutoPull } from '@/hooks/use-auto-pull';
import { CancellationAlert } from './cancellation-alert';
import { TrackingScheduler } from './tracking-scheduler';
import { FeedbackMonitor } from './feedback-monitor';
import { useOrderStore } from '@/lib/store';
import { SignIn } from './sign-in';
import { TicketDialog } from './ticket-dialog';
import { TICKET_PRIORITY_CONFIG, TICKET_STATUS_CONFIG, DEPARTMENT_CONFIG, TicketRecord, TicketStatus, Department } from '@/lib/types';
import { can, resourceIdForPath, landingPathFor } from '@/lib/access';

const SIDEBAR_KEY = 'sidebar-collapsed';

export function AppShell({ children }: { children: React.ReactNode }) {
  // Manual show/hide toggle, persisted across pages/reloads (no auto-hide).
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  });

  const toggleSidebar = () => setSidebarCollapsed((prev) => {
    const next = !prev;
    try { localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

  const router = useRouter();

  // Initialize Supabase sync (auto-syncs on load and periodically)
  useSupabaseSync();
  // Automatically pull new marketplace orders every 30 minutes.
  useAutoPull();

  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const currentUser = users.find((u) => u.id === currentUserId);
  const accessControl = useOrderStore((s) => s.accessControl);
  // Buyer messages (Inbox / email) visibility — governed by the access rules.
  const canInbox = can(currentUser, 'feature:buyer-inbox', accessControl);

  // Direct-URL guard: if the current page maps to a resource this user can't
  // access, bounce them to their landing page. Covers deep links without gating
  // every page component individually.
  const pathname = usePathname();
  useEffect(() => {
    if (!currentUser) return;
    const resourceId = resourceIdForPath(pathname);
    if (!resourceId || can(currentUser, resourceId, accessControl)) return;
    const target = landingPathFor(currentUser, accessControl);
    // Guard against redirecting to the same (still-inaccessible) page — no loops.
    if (target !== resourceId && target !== pathname) router.replace(target);
  }, [pathname, currentUser, accessControl, router]);
  const setCurrentUser = useOrderStore((s) => s.setCurrentUser);

  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const msgRef = useRef<HTMLDivElement>(null);

  // Tickets
  const tickets = useOrderStore((s) => s.tickets);
  const ACTIVE_STATUSES: TicketStatus[] = ['open', 'in_progress', 'waiting'];
  const userDepts = useMemo<Department[]>(() => (
    currentUser ? (currentUser.departments?.length ? currentUser.departments : [currentUser.department ?? 'management' as Department]) : []
  ), [currentUser]);
  const seesAll = currentUser?.role === 'admin' || currentUser?.role === 'manager' || currentUser?.role === 'comms';
  const activeTickets = useMemo(() => {
    const active = tickets.filter((t) => ACTIVE_STATUSES.includes(t.status));
    const mine = seesAll ? active : active.filter((t) => (t.department && userDepts.includes(t.department)) || t.assigneeUserId === currentUser?.id);
    return [...mine].sort((a, b) => {
      const order = ['urgent', 'high', 'normal', 'low'];
      const d = order.indexOf(a.priority) - order.indexOf(b.priority);
      return d !== 0 ? d : b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [tickets, seesAll, userDepts, currentUser]);
  const [openTicket, setOpenTicket] = useState<TicketRecord | null>(null);

  // Feedback
  interface FbRow { feedback_id: string; comment_type: string; comment_text: string | null; buyer_masked: string | null; entered_period: string | null; acknowledged: boolean | null; first_seen_at: string; }
  const [fbOpen, setFbOpen] = useState(false);
  const fbRef = useRef<HTMLDivElement>(null);
  const [allFeedback, setAllFeedback] = useState<FbRow[]>([]);
  useEffect(() => {
    async function loadFeedback() {
      try {
        const { data } = await supabase.from('ebay_feedback').select('*').in('comment_type', ['NEGATIVE', 'POSITIVE']).order('first_seen_at', { ascending: false }).limit(40);
        setAllFeedback((data ?? []) as FbRow[]);
      } catch { /* silent */ }
    }
    loadFeedback();
  }, []);
  const negFeedback = allFeedback.filter((f) => f.comment_type === 'NEGATIVE');
  const posFeedback = allFeedback.filter((f) => f.comment_type === 'POSITIVE');
  const unacknowledgedNeg = negFeedback.filter((f) => !f.acknowledged);

  // Messages
  interface MsgRow { id: string; direction: string; status: string; message_text: string; buyer_username: string; sent_at: string; item_title?: string; }
  const [unreadMsgs, setUnreadMsgs] = useState<MsgRow[]>([]);
  useEffect(() => {
    if (!canInbox) return;   // only Comms + Admin may read buyer messages
    async function loadMsgs() {
      try {
        const res = await fetch('/api/ebay/messages/inbox');
        if (!res.ok) return;
        const { messages } = await res.json() as { messages: MsgRow[] };
        setUnreadMsgs(messages.filter(m => m.direction === 'received' && m.status === 'unread'));
      } catch { /* silent */ }
    }
    loadMsgs();
  }, [canInbox]);

  // Wait for the persisted store to rehydrate so an already-signed-in user
  // doesn't briefly flash the sign-in screen on reload.
  const [hydrated, setHydrated] = useState(useOrderStore.persist.hasHydrated());
  useEffect(() => {
    const unsub = useOrderStore.persist.onFinishHydration(() => setHydrated(true));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(useOrderStore.persist.hasHydrated());
    return unsub;
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
      if (msgRef.current && !msgRef.current.contains(e.target as Node)) setMsgOpen(false);
      if (fbRef.current && !fbRef.current.contains(e.target as Node)) setFbOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!hydrated) {
    return <div className="h-screen w-screen bg-slate-900" />;
  }

  // Not signed in → lock everything down to the sign-in screen (no sidebar, no content).
  if (!currentUser) {
    return <SignIn />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <EodScheduler />
      <TrackingScheduler />
      <div className="flex-shrink-0">
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      </div>
      <CancellationAlert />
      <FeedbackMonitor />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top header bar */}
        <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 sticky top-0 z-30">
          <Button variant="ghost" size="sm" onClick={toggleSidebar} className="h-8 w-8 p-0 text-slate-500" title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>

          <div className="flex items-center gap-1">

            {/* Feedback */}
            <div className="relative" ref={fbRef}>
              <button onClick={() => { setFbOpen((o) => !o); setBellOpen(false); setMsgOpen(false); setMenuOpen(false); }}
                className="relative h-8 flex items-center gap-1 px-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
                <ThumbsUp className="h-3.5 w-3.5 text-green-500" />
                <span className="text-[10px] font-semibold text-green-600">{posFeedback.length}</span>
                <span className="text-slate-300 text-xs">·</span>
                <ThumbsDown className="h-3.5 w-3.5 text-red-500" />
                <span className="text-[10px] font-semibold text-red-600">{negFeedback.length}</span>
                {unacknowledgedNeg.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
                    {unacknowledgedNeg.length}
                  </span>
                )}
              </button>
              {fbOpen && (
                <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-xs font-semibold text-green-700"><ThumbsUp className="h-3.5 w-3.5" />{posFeedback.length} positive</span>
                      <span className="flex items-center gap-1 text-xs font-semibold text-red-700"><ThumbsDown className="h-3.5 w-3.5" />{negFeedback.length} negative{unacknowledgedNeg.length > 0 && <span className="bg-red-100 text-red-700 text-[10px] rounded-full px-1.5 py-0.5 ml-1">{unacknowledgedNeg.length} new</span>}</span>
                    </div>
                    <button onClick={() => { router.push('/feedback'); setFbOpen(false); }} className="text-[10px] text-slate-400 hover:text-blue-600 flex items-center gap-0.5">All <ChevronRight className="h-3 w-3" /></button>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {negFeedback.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-4">No negative feedback 👍</p>
                    ) : negFeedback.slice(0, 6).map((f) => (
                      <button key={f.feedback_id} onClick={() => { router.push('/feedback'); setFbOpen(false); }}
                        className={`w-full text-left flex items-start gap-2 px-3 py-2 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 ${!f.acknowledged ? 'bg-red-50/40' : ''}`}>
                        <ThumbsDown className="h-3.5 w-3.5 mt-0.5 text-red-500 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-700 truncate">
                            {f.buyer_masked ?? 'Buyer'}
                            {!f.acknowledged && <span className="ml-1.5 text-[9px] bg-red-100 text-red-600 rounded px-1 py-0.5 font-bold">NEW</span>}
                            <span className="font-normal text-slate-400 ml-2 text-[10px]">{f.entered_period ? `within ${f.entered_period.toLowerCase()}` : ''}</span>
                          </p>
                          {f.comment_text && <p className="text-xs text-slate-600 truncate italic">"{f.comment_text}"</p>}
                        </div>
                      </button>
                    ))}
                    {posFeedback.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 bg-green-50 border-t border-green-100">
                          <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wide">Recent Positives</p>
                        </div>
                        {posFeedback.slice(0, 3).map((f) => (
                          <button key={f.feedback_id} onClick={() => { router.push('/feedback'); setFbOpen(false); }}
                            className="w-full text-left flex items-start gap-2 px-3 py-2 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0">
                            <ThumbsUp className="h-3.5 w-3.5 mt-0.5 text-green-500 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-slate-700 truncate">{f.buyer_masked ?? 'Buyer'}
                                <span className="font-normal text-slate-400 ml-2 text-[10px]">{f.entered_period ? `within ${f.entered_period.toLowerCase()}` : ''}</span>
                              </p>
                              {f.comment_text && <p className="text-xs text-slate-600 truncate italic">"{f.comment_text}"</p>}
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Bell — tickets */}
            <div className="relative" ref={bellRef}>
              <button onClick={() => { setBellOpen((o) => !o); setMsgOpen(false); setMenuOpen(false); setFbOpen(false); }}
                className="relative h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
                <Bell className="h-4 w-4" />
                {activeTickets.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
                    {activeTickets.length}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-700">Active Tickets {activeTickets.length > 0 && <span className="ml-1 bg-blue-100 text-blue-700 text-[10px] rounded-full px-1.5 py-0.5">{activeTickets.length}</span>}</p>
                    <button onClick={() => { router.push('/notes'); setBellOpen(false); }} className="text-[10px] text-slate-400 hover:text-blue-600 flex items-center gap-0.5">All <ChevronRight className="h-3 w-3" /></button>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {activeTickets.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">No active tickets 🎉</p>
                    ) : activeTickets.slice(0, 8).map((t) => {
                      const pr = TICKET_PRIORITY_CONFIG[t.priority];
                      const st = TICKET_STATUS_CONFIG[t.status];
                      return (
                        <button key={t.id} onClick={() => { setOpenTicket(t); setBellOpen(false); }}
                          className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${pr.color}`}>{pr.label}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-700 truncate">{t.subject}</p>
                            <p className="text-[10px] text-slate-400 truncate">{t.department ? DEPARTMENT_CONFIG[t.department].label : 'Unassigned'}{t.assigneeName ? ` · ${t.assigneeName}` : ''}</p>
                          </div>
                          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${st.color}`}>{st.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Messages — buyer Inbox, Comms + Admin only */}
            {canInbox && (
            <div className="relative" ref={msgRef}>
              <button onClick={() => { setMsgOpen((o) => !o); setBellOpen(false); setMenuOpen(false); setFbOpen(false); }}
                className="relative h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
                <MessageSquare className="h-4 w-4" />
                {unreadMsgs.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-amber-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
                    {unreadMsgs.length}
                  </span>
                )}
              </button>
              {msgOpen && (
                <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-700">Buyer Messages {unreadMsgs.length > 0 && <span className="ml-1 bg-amber-100 text-amber-700 text-[10px] rounded-full px-1.5 py-0.5">{unreadMsgs.length} unread</span>}</p>
                    <button onClick={() => { router.push('/notes'); setMsgOpen(false); }} className="text-[10px] text-slate-400 hover:text-blue-600 flex items-center gap-0.5">Inbox <ChevronRight className="h-3 w-3" /></button>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {unreadMsgs.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">No unread messages</p>
                    ) : unreadMsgs.slice(0, 8).map((m) => (
                      <button key={m.id} onClick={() => { router.push('/notes'); setMsgOpen(false); }}
                        className="w-full text-left flex items-start gap-2 px-3 py-2 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-700 truncate">{m.buyer_username}
                            <span className="font-normal text-slate-400 ml-2 text-[10px]">{new Date(m.sent_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          </p>
                          {m.item_title && <p className="text-[10px] text-slate-400 truncate">{m.item_title}</p>}
                          <p className="text-xs text-slate-600 truncate">{m.message_text}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* User menu */}
            <div className="relative ml-1" ref={menuRef}>
              <button onClick={() => { setMenuOpen((o) => !o); setBellOpen(false); setMsgOpen(false); }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                <div className="h-7 w-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {currentUser.name.charAt(0).toUpperCase()}
                </div>
                <div className="text-left hidden sm:block">
                  <p className="text-xs font-semibold text-slate-800 leading-tight">{currentUser.name}</p>
                  <p className="text-[10px] text-slate-500 capitalize leading-tight">{currentUser.role}</p>
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-100">
                    <p className="text-xs font-semibold text-slate-700">{currentUser.name}</p>
                    <p className="text-[10px] text-slate-400 capitalize">{currentUser.role}</p>
                  </div>
                  <div className="px-2 py-1.5 max-h-64 overflow-y-auto">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-1 mb-1">Switch user</p>
                    {users.map((u) => (
                      <button key={u.id} onClick={() => { setCurrentUser(u.id); setMenuOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-left transition-colors">
                        <div className="h-6 w-6 rounded-full bg-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-700 truncate">{u.name}</p>
                          <p className="text-[10px] text-slate-400 capitalize">{u.role}</p>
                        </div>
                        {u.id === currentUser.id && <Check className="h-3.5 w-3.5 text-blue-500 shrink-0" />}
                      </button>
                    ))}
                  </div>
                  <div className="px-2 pb-1.5 border-t border-slate-100 pt-1.5">
                    <button onClick={() => { setCurrentUser(null); setMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-red-50 text-red-600 text-xs font-medium transition-colors">
                      <LogOut className="h-3.5 w-3.5" /> Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        {openTicket && <TicketDialog ticket={openTicket} onClose={() => setOpenTicket(null)} />}
        <main className="flex-1 bg-slate-50 overflow-auto">
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
