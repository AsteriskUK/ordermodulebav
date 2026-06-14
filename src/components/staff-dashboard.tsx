'use client';

import { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOrderStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  ORDER_STATUS_CONFIG,
  DEPARTMENT_CONFIG,
  Department,
  OrderStatus,
} from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Clock,
  Wrench,
  ClipboardCheck,
  BoxSelect,
  Package,
  PauseCircle,
  PackageX,
  CheckCircle,
  ArrowRight,
  Layers,
  User,
  TrendingUp,
  MessageSquare,
  LogIn,
  LogOut,
  Coffee,
} from 'lucide-react';

const PIPELINE_STATUSES: { status: OrderStatus; icon: React.ElementType }[] = [
  { status: 'pending',    icon: Clock },
  { status: 'assembling', icon: Wrench },
  { status: 'checking',   icon: ClipboardCheck },
  { status: 'packing',    icon: BoxSelect },
  { status: 'packed',     icon: Package },
  { status: 'no-stock',   icon: PackageX },
  { status: 'held',       icon: PauseCircle },
];

function getAllowedCategories(depts: Department[]): string[] | null {
  const cats: string[] = [];
  let hasOpenDept = false;
  for (const d of depts) {
    const cfg = DEPARTMENT_CONFIG[d];
    if (!cfg) continue;
    if (!cfg.categories) { hasOpenDept = true; break; }
    cats.push(...cfg.categories);
  }
  return hasOpenDept ? null : cats.length ? cats : null;
}

export function StaffDashboard() {
  const router = useRouter();
  const orders = useOrderStore((s) => s.orders);
  const eodEvents = useOrderStore((s) => s.eodEvents);
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);

  const currentUser = users.find((u) => u.id === currentUserId);
  const userDepts: Department[] = currentUser
    ? (currentUser.departments?.length ? currentUser.departments : [currentUser.department ?? 'management'])
    : [];
  const allowedCategories = getAllowedCategories(userDepts);

  const myOrders = useMemo(() => {
    if (!allowedCategories) return orders;
    return orders.filter((o) => allowedCategories.includes(o.category));
  }, [orders, allowedCategories]);

  const statusCounts = useMemo(() =>
    myOrders.reduce((acc, o) => {
      acc[o.status] = (acc[o.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  [myOrders]);

  const todayStr = new Date().toDateString();
  const myTodayEvents = useMemo(() =>
    eodEvents.filter((e) => {
      const sameUser = e.userId === currentUserId;
      const today = new Date(e.changedAt).toDateString() === todayStr;
      return sameUser && today;
    }),
  [eodEvents, currentUserId, todayStr]);

  const todayActionsCount = myTodayEvents.length;
  const todayShipped = myTodayEvents.filter((e) => e.toStatus === 'shipped').length;
  const todayPacked  = myTodayEvents.filter((e) => e.toStatus === 'packed').length;
  const todayAssembled = myTodayEvents.filter((e) => e.toStatus === 'assembling').length;

  const urgentCount = (statusCounts['pending'] || 0) + (statusCounts['no-stock'] || 0) + (statusCounts['held'] || 0);
  const inProgressCount = (statusCounts['assembling'] || 0) + (statusCounts['checking'] || 0) + (statusCounts['packing'] || 0);

  const allOrders = useOrderStore((s) => s.orders);
  const totalNotes = allOrders.reduce((sum, o) => sum + (o.notes?.length ?? 0), 0);

  // Attendance
  const attendanceRecords = useOrderStore((s) => s.attendanceRecords);
  const clockInAction = useOrderStore((s) => s.clockIn);
  const clockOutAction = useOrderStore((s) => s.clockOut);
  const updateAttendance = useOrderStore((s) => s.updateAttendance);
  
  const today = new Date().toISOString().slice(0, 10);
  const myTodayAttendance = attendanceRecords.find(
    (r) => r.userId === currentUserId && r.date === today
  );
  
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleClockIn = () => {
    if (!currentUserId) return;
    clockInAction(currentUserId);
  };

  const handleClockOut = () => {
    if (!currentUserId) return;
    clockOutAction(currentUserId);
  };

  const handleBreak = () => {
    if (!myTodayAttendance) return;
    const newStatus = myTodayAttendance.status === 'half-day' ? 'present' : 'half-day';
    updateAttendance(myTodayAttendance.id, { status: newStatus });
  };
  const recentNote = allOrders
    .flatMap((o) => (o.notes ?? []).map((n) => ({ ...n, salesRecordNumber: o.salesRecordNumber })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <User className="h-12 w-12 text-slate-300 mb-4" />
        <h3 className="text-lg font-semibold text-slate-700">Not signed in</h3>
        <p className="text-sm text-slate-400 mt-1">Please select your user profile to see your queue.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            Hello, {currentUser.name} 👋
          </h2>
          <p className="text-slate-500 text-sm mt-1">Here's your queue for today</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {userDepts.map((d) => (
            <Badge key={d} variant="outline" className={`text-xs ${DEPARTMENT_CONFIG[d]?.color ?? ''}`}>
              {DEPARTMENT_CONFIG[d]?.label ?? d}
            </Badge>
          ))}
          {allowedCategories && (
            <span className="text-xs text-slate-400 self-center ml-1">
              · {myOrders.length} orders in scope
            </span>
          )}
        </div>
      </div>

      {/* Big Clock In/Out Card */}
      <Card className={cn(
        "border-2 transition-all",
        !myTodayAttendance?.clockIn ? "border-slate-200 bg-slate-50" :
        !myTodayAttendance?.clockOut ? "border-green-200 bg-green-50" :
        "border-blue-200 bg-blue-50"
      )}>
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            {/* Time Display */}
            <div className="text-center md:text-left">
              <div className="text-5xl md:text-6xl font-bold text-slate-800 tracking-tight">
                {currentTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-sm text-slate-500 mt-1">
                {currentTime.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              {myTodayAttendance?.clockIn && (
                <div className="text-xs text-slate-500 mt-2">
                  Clocked in: {new Date(myTodayAttendance.clockIn).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  {myTodayAttendance.clockOut && (
                    <span> • Out: {new Date(myTodayAttendance.clockOut).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                  )}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              {!myTodayAttendance?.clockIn ? (
                <Button 
                  size="lg" 
                  className="h-16 px-8 text-lg bg-green-600 hover:bg-green-700"
                  onClick={handleClockIn}
                >
                  <LogIn className="h-6 w-6 mr-3" />
                  Clock In
                </Button>
              ) : !myTodayAttendance?.clockOut ? (
                <>
                  <Button 
                    size="lg" 
                    variant="outline"
                    className={cn(
                      "h-16 px-6 text-base",
                      myTodayAttendance.status === 'half-day' && "bg-yellow-100 border-yellow-300 text-yellow-700"
                    )}
                    onClick={handleBreak}
                  >
                    <Coffee className="h-5 w-5 mr-2" />
                    {myTodayAttendance.status === 'half-day' ? 'End Break' : 'Break'}
                  </Button>
                  <Button 
                    size="lg" 
                    variant="default"
                    className="h-16 px-8 text-lg bg-red-600 hover:bg-red-700"
                    onClick={handleClockOut}
                  >
                    <LogOut className="h-6 w-6 mr-3" />
                    Clock Out
                  </Button>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-8 w-8 text-green-500" />
                  <div>
                    <div className="font-semibold text-slate-700">Done for today!</div>
                    <div className="text-sm text-slate-500">
                      {(() => {
                        const start = new Date(myTodayAttendance.clockIn!).getTime();
                        const end = new Date(myTodayAttendance.clockOut!).getTime();
                        const diff = end - start;
                        const hours = Math.floor(diff / 3600000);
                        const mins = Math.floor((diff % 3600000) / 60000);
                        return `${hours}h ${mins}m worked`;
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Team Notes tile */}
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100"
        onClick={() => router.push('/notes')}
      >
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-1">
            <MessageSquare className="h-4 w-4 text-blue-500" />
            {totalNotes > 0 && (
              <span className="bg-blue-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                {totalNotes}
              </span>
            )}
          </div>
          <div className="text-2xl font-bold text-blue-700">{totalNotes}</div>
          <p className="text-xs text-blue-600 mt-0.5">Team Notes</p>
          {recentNote && (
            <p className="text-xs text-blue-500 mt-1 truncate">
              {recentNote.authorName}: {recentNote.text.slice(0, 35)}{recentNote.text.length > 35 ? '…' : ''}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Today's personal stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between mb-1">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-blue-500 font-medium">Today</span>
            </div>
            <div className="text-2xl font-bold text-blue-700">{todayActionsCount}</div>
            <p className="text-xs text-blue-600 mt-0.5">Actions taken</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between mb-1">
              <Package className="h-4 w-4 text-purple-500" />
              <span className="text-xs text-purple-500 font-medium">Today</span>
            </div>
            <div className="text-2xl font-bold text-purple-700">{todayShipped}</div>
            <p className="text-xs text-purple-600 mt-0.5">Shipped</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-indigo-50 to-indigo-100 border-indigo-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between mb-1">
              <BoxSelect className="h-4 w-4 text-indigo-500" />
              <span className="text-xs text-indigo-500 font-medium">Today</span>
            </div>
            <div className="text-2xl font-bold text-indigo-700">{todayPacked}</div>
            <p className="text-xs text-indigo-600 mt-0.5">Packed</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between mb-1">
              <Wrench className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-amber-500 font-medium">Today</span>
            </div>
            <div className="text-2xl font-bold text-amber-700">{todayAssembled}</div>
            <p className="text-xs text-amber-600 mt-0.5">Started assembling</p>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline status counts */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="h-4 w-4" />
            My Queue
          </CardTitle>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => router.push('/packaging')}>
            Open Queue
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {PIPELINE_STATUSES.map(({ status, icon: Icon }) => {
              const cfg = ORDER_STATUS_CONFIG[status];
              const count = statusCounts[status] || 0;
              const isUrgent = status === 'no-stock' || status === 'held';
              return (
                <button
                  key={status}
                  onClick={() => router.push('/packaging')}
                  className={`flex flex-col items-center p-3 rounded-lg border transition-all hover:shadow-md hover:scale-105 ${cfg.color} ${
                    count > 0 && isUrgent ? 'ring-2 ring-offset-1 ring-orange-400 animate-pulse' : ''
                  }`}
                >
                  <Icon className="h-5 w-5 mb-1" />
                  <span className="text-xl font-bold">{count}</span>
                  <span className="text-xs text-center leading-tight mt-0.5">{cfg.label}</span>
                </button>
              );
            })}
          </div>

          {/* Summary bar */}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t text-xs text-slate-500 flex-wrap">
            <span className={`font-medium ${urgentCount > 0 ? 'text-red-600' : 'text-slate-400'}`}>
              ⚠ {urgentCount} need attention
            </span>
            <span className="text-amber-600 font-medium">
              ⚙ {inProgressCount} in progress
            </span>
            <span className="text-green-600 font-medium">
              ✓ {statusCounts['packed'] || 0} packed &amp; ready
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Recent activity — orders I've touched today */}
      {myTodayEvents.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              Today's Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {[...myTodayEvents].reverse().slice(0, 20).map((ev, i) => {
                const from = ORDER_STATUS_CONFIG[ev.fromStatus];
                const to = ORDER_STATUS_CONFIG[ev.toStatus];
                return (
                  <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-slate-100 last:border-0">
                    <span className="font-mono text-slate-400 shrink-0">#{ev.salesRecordNumber}</span>
                    <span className="text-slate-600 truncate flex-1">{ev.itemTitle}</span>
                    <span className={`px-1.5 py-0.5 rounded border text-xs shrink-0 ${from.color}`}>{from.label}</span>
                    <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
                    <span className={`px-1.5 py-0.5 rounded border text-xs shrink-0 ${to.color}`}>{to.label}</span>
                    <span className="text-slate-400 shrink-0">
                      {new Date(ev.changedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {myOrders.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-slate-200 mb-4" />
            <h3 className="text-base font-medium text-slate-500">No orders in your queue</h3>
            <p className="text-sm text-slate-400 mt-1">
              {allowedCategories
                ? `Showing orders for: ${allowedCategories.join(', ')}`
                : 'All orders will appear here once imported'}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
