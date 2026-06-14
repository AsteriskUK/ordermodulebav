'use client';

import { useState, useMemo } from 'react';
import { useOrderStore } from '@/lib/store';
import { AttendanceStatus, LeaveStatus, LeaveType, AttendanceRecord, LeaveRequest, Department } from '@/lib/types';
import { DEPARTMENT_CONFIG } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { 
  Clock, 
  Calendar, 
  CheckCircle, 
  XCircle, 
  UserCheck, 
  UserX,
  Briefcase,
  Plus,
  Filter,
  Download
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ATTENDANCE_CONFIG: Record<AttendanceStatus, { label: string; color: string; bg: string }> = {
  present: { label: 'Present', color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
  absent: { label: 'Absent', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
  late: { label: 'Late', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
  'half-day': { label: 'Half Day', color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' },
  wfh: { label: 'WFH', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
};

const LEAVE_TYPE_CONFIG: Record<LeaveType, { label: string; color: string }> = {
  annual: { label: 'Annual Leave', color: 'text-blue-600' },
  sick: { label: 'Sick Leave', color: 'text-red-600' },
  unpaid: { label: 'Unpaid', color: 'text-gray-600' },
  maternity: { label: 'Maternity', color: 'text-pink-600' },
  paternity: { label: 'Paternity', color: 'text-indigo-600' },
  bereavement: { label: 'Bereavement', color: 'text-purple-600' },
  other: { label: 'Other', color: 'text-slate-600' },
};

const LEAVE_STATUS_CONFIG: Record<LeaveStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: 'text-yellow-700', bg: 'bg-yellow-100' },
  approved: { label: 'Approved', color: 'text-green-700', bg: 'bg-green-100' },
  rejected: { label: 'Rejected', color: 'text-red-700', bg: 'bg-red-100' },
  cancelled: { label: 'Cancelled', color: 'text-gray-700', bg: 'bg-gray-100' },
};

function formatTime(isoString?: string): string {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function calculateDuration(clockIn?: string, clockOut?: string): string {
  if (!clockIn || !clockOut) return '-';
  const start = new Date(clockIn).getTime();
  const end = new Date(clockOut).getTime();
  const diff = end - start;
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

export function HRDashboard() {
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const currentUser = users.find((u) => u.id === currentUserId);
  const isAdminOrManager = currentUser?.role === 'admin' || currentUser?.role === 'manager';
  
  const attendanceRecords = useOrderStore((s) => s.attendanceRecords);
  const leaveRequests = useOrderStore((s) => s.leaveRequests);
  const leaveBalances = useOrderStore((s) => s.leaveBalances);
  
  const clockIn = useOrderStore((s) => s.clockIn);
  const clockOut = useOrderStore((s) => s.clockOut);
  const updateAttendance = useOrderStore((s) => s.updateAttendance);
  const addLeaveRequest = useOrderStore((s) => s.addLeaveRequest);
  const approveLeave = useOrderStore((s) => s.approveLeave);
  const rejectLeave = useOrderStore((s) => s.rejectLeave);
  const cancelLeave = useOrderStore((s) => s.cancelLeave);

  const [activeTab, setActiveTab] = useState<'attendance' | 'leave'>('attendance');
  const [selectedUserId, setSelectedUserId] = useState<string>(currentUserId || '');
  const [dateFilter, setDateFilter] = useState<string>('');
  
  // Leave request form state
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>('annual');
  const [leaveStartDate, setLeaveStartDate] = useState('');
  const [leaveEndDate, setLeaveEndDate] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  // Get today's attendance for current user
  const myTodayAttendance = useMemo(() => {
    if (!currentUserId) return null;
    return attendanceRecords.find(
      (r) => r.userId === currentUserId && r.date === today
    );
  }, [attendanceRecords, currentUserId, today]);

  // Filtered records
  const filteredAttendance = useMemo(() => {
    let records = [...attendanceRecords];
    if (selectedUserId) {
      records = records.filter((r) => r.userId === selectedUserId);
    }
    if (dateFilter) {
      records = records.filter((r) => r.date.startsWith(dateFilter));
    }
    return records.sort((a, b) => b.date.localeCompare(a.date));
  }, [attendanceRecords, selectedUserId, dateFilter]);

  const filteredLeaveRequests = useMemo(() => {
    let requests = [...leaveRequests];
    if (selectedUserId && !isAdminOrManager) {
      // Staff only see their own
      requests = requests.filter((r) => r.userId === currentUserId);
    } else if (selectedUserId && isAdminOrManager) {
      // Admin can filter by user
      requests = requests.filter((r) => r.userId === selectedUserId);
    } else if (!isAdminOrManager) {
      // Staff without filter see their own
      requests = requests.filter((r) => r.userId === currentUserId);
    }
    return requests.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }, [leaveRequests, selectedUserId, currentUserId, isAdminOrManager]);

  // Stats
  const attendanceStats = useMemo(() => {
    const stats: Record<AttendanceStatus, number> = { present: 0, absent: 0, late: 0, 'half-day': 0, wfh: 0 };
    filteredAttendance.forEach((r) => {
      stats[r.status] = (stats[r.status] || 0) + 1;
    });
    return stats;
  }, [filteredAttendance]);

  const leaveStats = useMemo(() => {
    const pending = filteredLeaveRequests.filter((r) => r.status === 'pending').length;
    const approved = filteredLeaveRequests.filter((r) => r.status === 'approved').length;
    return { pending, approved };
  }, [filteredLeaveRequests]);

  const handleClockIn = () => {
    if (!currentUserId) {
      toast.error('Please sign in first');
      return;
    }
    clockIn(currentUserId);
    toast.success('Clocked in successfully');
  };

  const handleClockOut = () => {
    if (!currentUserId) return;
    clockOut(currentUserId);
    toast.success('Clocked out successfully');
  };

  const handleSubmitLeave = () => {
    if (!currentUserId) {
      toast.error('Please sign in first');
      return;
    }
    if (!leaveStartDate || !leaveEndDate || !leaveReason) {
      toast.error('Please fill in all fields');
      return;
    }
    if (leaveStartDate > leaveEndDate) {
      toast.error('End date must be after start date');
      return;
    }
    
    const days = Math.ceil((new Date(leaveEndDate).getTime() - new Date(leaveStartDate).getTime()) / 86400000) + 1;
    
    addLeaveRequest({
      userId: currentUserId,
      type: leaveType,
      startDate: leaveStartDate,
      endDate: leaveEndDate,
      days,
      reason: leaveReason,
    });
    
    toast.success('Leave request submitted');
    setShowLeaveForm(false);
    setLeaveStartDate('');
    setLeaveEndDate('');
    setLeaveReason('');
  };

  const handleApprove = (requestId: string) => {
    if (!currentUserId) return;
    approveLeave(requestId, currentUserId);
    toast.success('Leave request approved');
  };

  const handleReject = (requestId: string) => {
    if (!rejectionReason.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }
    rejectLeave(requestId, rejectionReason);
    toast.success('Leave request rejected');
    setRejectingId(null);
    setRejectionReason('');
  };

  const handleCancel = (requestId: string) => {
    cancelLeave(requestId);
    toast.success('Leave request cancelled');
  };

  // Get user's leave balance
  const currentYear = new Date().getFullYear();
  const myBalance = useMemo(() => {
    if (!currentUserId) return null;
    return leaveBalances.find((b) => b.userId === currentUserId && b.year === currentYear);
  }, [leaveBalances, currentUserId, currentYear]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">HR Module</h1>
        <div className="flex items-center gap-2">
          {isAdminOrManager && (
            <select
              className="px-3 py-2 border rounded-lg text-sm"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value="">All Staff</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          )}
          <Button
            variant={activeTab === 'attendance' ? 'default' : 'outline'}
            onClick={() => setActiveTab('attendance')}
          >
            <Clock className="h-4 w-4 mr-2" />
            Attendance
          </Button>
          <Button
            variant={activeTab === 'leave' ? 'default' : 'outline'}
            onClick={() => setActiveTab('leave')}
          >
            <Calendar className="h-4 w-4 mr-2" />
            Leave
          </Button>
        </div>
      </div>

      {/* My Quick Actions */}
      {currentUserId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">My Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 flex-wrap">
              {activeTab === 'attendance' ? (
                <>
                  <div className="flex items-center gap-2">
                    {myTodayAttendance ? (
                      <div className="flex items-center gap-2">
                        <span className={cn('px-3 py-1 rounded-full text-sm font-medium', ATTENDANCE_CONFIG[myTodayAttendance.status].bg, ATTENDANCE_CONFIG[myTodayAttendance.status].color)}>
                          {ATTENDANCE_CONFIG[myTodayAttendance.status].label}
                        </span>
                        <span className="text-sm text-slate-500">
                          In: {formatTime(myTodayAttendance.clockIn)}
                          {myTodayAttendance.clockOut && ` • Out: ${formatTime(myTodayAttendance.clockOut)}`}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-500">Not clocked in today</span>
                    )}
                  </div>
                  {!myTodayAttendance?.clockIn ? (
                    <Button onClick={handleClockIn}>
                      <Clock className="h-4 w-4 mr-2" />
                      Clock In
                    </Button>
                  ) : !myTodayAttendance?.clockOut ? (
                    <Button variant="outline" onClick={handleClockOut}>
                      <Clock className="h-4 w-4 mr-2" />
                      Clock Out
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">{myBalance?.annual ?? 25}</div>
                      <div className="text-xs text-slate-500">Annual Leave</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">{myBalance?.annual && myBalance?.used?.annual ? myBalance.annual - myBalance.used.annual : 25}</div>
                      <div className="text-xs text-slate-500">Available</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-orange-600">{myBalance?.used?.annual ?? 0}</div>
                      <div className="text-xs text-slate-500">Used</div>
                    </div>
                  </div>
                  <Button onClick={() => setShowLeaveForm(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Request Leave
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'attendance' ? (
        <>
          {/* Attendance Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {(Object.keys(ATTENDANCE_CONFIG) as AttendanceStatus[]).map((status) => (
              <Card key={status}>
                <CardContent className="p-4">
                  <div className={cn('text-2xl font-bold', ATTENDANCE_CONFIG[status].color)}>
                    {attendanceStats[status] || 0}
                  </div>
                  <div className="text-xs text-slate-500">{ATTENDANCE_CONFIG[status].label}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Attendance Records */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Attendance Records</CardTitle>
              <div className="flex items-center gap-2">
                <Input
                  type="month"
                  className="w-40"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                />
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Date</th>
                      <th className="text-left py-2 px-3">Staff</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Clock In</th>
                      <th className="text-left py-2 px-3">Clock Out</th>
                      <th className="text-left py-2 px-3">Duration</th>
                      {isAdminOrManager && <th className="text-left py-2 px-3">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAttendance.length === 0 ? (
                      <tr>
                        <td colSpan={isAdminOrManager ? 7 : 6} className="py-8 text-center text-slate-500">
                          No attendance records found
                        </td>
                      </tr>
                    ) : (
                      filteredAttendance.map((record) => {
                        const user = users.find((u) => u.id === record.userId);
                        const cfg = ATTENDANCE_CONFIG[record.status];
                        return (
                          <tr key={record.id} className="border-b hover:bg-slate-50">
                            <td className="py-2 px-3">{formatDate(record.date)}</td>
                            <td className="py-2 px-3">{user?.name || 'Unknown'}</td>
                            <td className="py-2 px-3">
                              <span className={cn('px-2 py-0.5 rounded text-xs font-medium', cfg.bg, cfg.color)}>
                                {cfg.label}
                              </span>
                            </td>
                            <td className="py-2 px-3">{formatTime(record.clockIn)}</td>
                            <td className="py-2 px-3">{formatTime(record.clockOut)}</td>
                            <td className="py-2 px-3">{calculateDuration(record.clockIn, record.clockOut)}</td>
                            {isAdminOrManager && (
                              <td className="py-2 px-3">
                                <select
                                  className="text-xs border rounded px-2 py-1"
                                  value={record.status}
                                  onChange={(e) => updateAttendance(record.id, { status: e.target.value as AttendanceStatus })}
                                >
                                  {(Object.keys(ATTENDANCE_CONFIG) as AttendanceStatus[]).map((s) => (
                                    <option key={s} value={s}>{ATTENDANCE_CONFIG[s].label}</option>
                                  ))}
                                </select>
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* Leave Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-yellow-600">{leaveStats.pending}</div>
                <div className="text-xs text-slate-500">Pending Requests</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-green-600">{leaveStats.approved}</div>
                <div className="text-xs text-slate-500">Approved</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-blue-600">{filteredLeaveRequests.length}</div>
                <div className="text-xs text-slate-500">Total Requests</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-purple-600">
                  {filteredLeaveRequests.filter((r) => r.status === 'approved').reduce((sum, r) => sum + r.days, 0)}
                </div>
                <div className="text-xs text-slate-500">Days Approved</div>
              </CardContent>
            </Card>
          </div>

          {/* Leave Requests */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Leave Requests</CardTitle>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredLeaveRequests.length === 0 ? (
                  <div className="py-8 text-center text-slate-500">
                    No leave requests found
                  </div>
                ) : (
                  filteredLeaveRequests.map((request) => {
                    const user = users.find((u) => u.id === request.userId);
                    const statusCfg = LEAVE_STATUS_CONFIG[request.status];
                    const typeCfg = LEAVE_TYPE_CONFIG[request.type];
                    
                    return (
                      <div key={request.id} className="border rounded-lg p-4 hover:shadow-sm transition-shadow">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium">{user?.name || 'Unknown'}</span>
                              <span className={cn('text-xs px-2 py-0.5 rounded-full', statusCfg.bg, statusCfg.color)}>
                                {statusCfg.label}
                              </span>
                            </div>
                            <div className="text-sm text-slate-600 mb-1">
                              <span className={typeCfg.color}>{typeCfg.label}</span>
                              {' • '}
                              {formatDate(request.startDate)} - {formatDate(request.endDate)}
                              {' • '}
                              <span className="font-medium">{request.days} days</span>
                            </div>
                            <div className="text-sm text-slate-500">
                              Reason: {request.reason}
                            </div>
                            {request.rejectionReason && (
                              <div className="text-sm text-red-600 mt-1">
                                Rejection: {request.rejectionReason}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {isAdminOrManager && request.status === 'pending' && (
                              <>
                                <Button size="sm" variant="outline" className="text-green-600" onClick={() => handleApprove(request.id)}>
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  Approve
                                </Button>
                                <Button size="sm" variant="outline" className="text-red-600" onClick={() => setRejectingId(request.id)}>
                                  <XCircle className="h-4 w-4 mr-1" />
                                  Reject
                                </Button>
                              </>
                            )}
                            {request.userId === currentUserId && request.status === 'pending' && (
                              <Button size="sm" variant="ghost" onClick={() => handleCancel(request.id)}>
                                Cancel
                              </Button>
                            )}
                          </div>
                        </div>
                        
                        {/* Rejection reason input */}
                        {rejectingId === request.id && (
                          <div className="mt-3 flex items-center gap-2">
                            <Input
                              placeholder="Rejection reason..."
                              value={rejectionReason}
                              onChange={(e) => setRejectionReason(e.target.value)}
                              className="flex-1"
                            />
                            <Button size="sm" variant="default" onClick={() => handleReject(request.id)}>
                              Confirm Reject
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setRejectingId(null); setRejectionReason(''); }}>
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Leave Request Modal */}
      {showLeaveForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Request Leave</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Leave Type</label>
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                >
                  {(Object.keys(LEAVE_TYPE_CONFIG) as LeaveType[]).map((t) => (
                    <option key={t} value={t}>{LEAVE_TYPE_CONFIG[t].label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Start Date</label>
                  <Input type="date" value={leaveStartDate} onChange={(e) => setLeaveStartDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">End Date</label>
                  <Input type="date" value={leaveEndDate} onChange={(e) => setLeaveEndDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Reason</label>
                <Input value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="Enter reason..." />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowLeaveForm(false)}>Cancel</Button>
                <Button onClick={handleSubmitLeave}>Submit Request</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
