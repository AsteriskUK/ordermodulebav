'use client';

import { useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { AppUser, UserRole, Department, DEPARTMENT_CONFIG } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Users, Plus, Trash2, Pencil, Check, X, ShieldCheck, User, Briefcase } from 'lucide-react';
import { toast } from 'sonner';

const ROLE_CONFIG: Record<UserRole, { label: string; color: string; icon: React.ElementType; description: string }> = {
  admin: {
    label: 'Admin',
    color: 'bg-red-100 text-red-800 border-red-300',
    icon: ShieldCheck,
    description: 'Full access — import, manage orders, manage users',
  },
  manager: {
    label: 'Manager',
    color: 'bg-blue-100 text-blue-800 border-blue-300',
    icon: Briefcase,
    description: 'Can manage orders and view reports, cannot manage users',
  },
  staff: {
    label: 'Staff',
    color: 'bg-green-100 text-green-800 border-green-300',
    icon: User,
    description: 'Can process orders and update statuses only',
  },
  comms: {
    label: 'Comms',
    color: 'bg-purple-100 text-purple-800 border-purple-300',
    icon: User,
    description: 'Can place orders on hold; senior comms can release holds',
  },
};

const ALL_DEPTS = Object.keys(DEPARTMENT_CONFIG) as Department[];

function DeptCheckboxes({
  selected,
  onChange,
}: {
  selected: Department[];
  onChange: (d: Department[]) => void;
}) {
  const toggle = (d: Department) =>
    onChange(selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_DEPTS.map((d) => {
        const cfg = DEPARTMENT_CONFIG[d];
        const active = selected.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => toggle(d)}
            className={`px-2 py-0.5 rounded border text-xs font-medium transition-colors ${
              active ? cfg.color + ' opacity-100' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'
            }`}
          >
            {cfg.label}
          </button>
        );
      })}
    </div>
  );
}

// Generate proper UUID v4 for PostgreSQL compatibility
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function UserManagement() {
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const addUser = useOrderStore((s) => s.addUser);
  const updateUser = useOrderStore((s) => s.updateUser);
  const deleteUser = useOrderStore((s) => s.deleteUser);
  const setCurrentUser = useOrderStore((s) => s.setCurrentUser);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('staff');
  const [editDepts, setEditDepts] = useState<Department[]>([]);
  const [editPin, setEditPin] = useState('');

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('staff');
  const [newDepts, setNewDepts] = useState<Department[]>([]);
  const [newPin, setNewPin] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const currentUser = users.find((u) => u.id === currentUserId);

  const startEdit = (user: AppUser) => {
    setEditingId(user.id);
    setEditName(user.name);
    setEditRole(user.role);
    setEditDepts(user.departments?.length ? user.departments : [user.department ?? 'management']);
    setEditPin(user.pin || '');
  };

  const saveEdit = () => {
    if (!editName.trim()) { toast.error('Name is required'); return; }
    if (!editDepts.length) { toast.error('Select at least one department'); return; }
    updateUser(editingId!, {
      name: editName.trim(),
      role: editRole,
      roles: [editRole],
      department: editDepts[0],
      departments: editDepts,
      pin: editPin || undefined,
    });
    toast.success('User updated');
    setEditingId(null);
  };

  const handleAdd = () => {
    if (!newName.trim()) { toast.error('Name is required'); return; }
    if (!newDepts.length) { toast.error('Select at least one department'); return; }
    addUser({
      id: generateUUID(),
      name: newName.trim(),
      email: newEmail.trim() || undefined,
      role: newRole,
      roles: [newRole],
      department: newDepts[0],
      departments: newDepts,
      pin: newPin || undefined,
    });
    toast.success(`${newName} added`);
    setNewName('');
    setNewEmail('');
    setNewRole('staff');
    setNewDepts([]);
    setNewPin('');
    setShowAdd(false);
  };

  const handleDelete = (user: AppUser) => {
    if (user.id === currentUserId) {
      toast.error('Cannot delete the currently active user');
      return;
    }
    deleteUser(user.id);
    toast.success(`${user.name} removed`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Users &amp; Roles</h2>
          <p className="text-slate-500 text-sm mt-1">
            Manage team access and permissions
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="h-3 w-3 mr-1" />
          Add User
        </Button>
      </div>

      {/* Active session */}
      {currentUser && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <ShieldCheck className="h-4 w-4 text-blue-500 shrink-0" />
          <span className="text-blue-800">
            Active session: <strong>{currentUser.name}</strong>{' '}
            <span className="text-blue-500">({ROLE_CONFIG[currentUser.role].label})</span>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 text-xs"
            onClick={() => { setCurrentUser(null); toast.success('Signed out'); }}
          >
            Sign Out
          </Button>
        </div>
      )}

      {/* Role legend */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {(Object.entries(ROLE_CONFIG) as [UserRole, typeof ROLE_CONFIG[UserRole]][]).map(([role, cfg]) => {
          const Icon = cfg.icon;
          return (
            <Card key={role}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="h-4 w-4" />
                  <Badge variant="outline" className={cfg.color}>{cfg.label}</Badge>
                </div>
                <p className="text-xs text-slate-500">{cfg.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add user form */}
      {showAdd && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-sm text-blue-800">New User</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Name</label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Full name"
                  className="w-44 h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Email</label>
                <Input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="email@company.com"
                  type="email"
                  className="w-48 h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Role</label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as UserRole)}>
                  <SelectTrigger className="w-32 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="staff">Staff</SelectItem>
                    <SelectItem value="comms">Comms</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">PIN (optional)</label>
                <Input
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  placeholder="4-digit PIN"
                  maxLength={6}
                  className="w-28 h-8 text-sm font-mono"
                />
              </div>
              <Button size="sm" onClick={handleAdd} className="h-8">
                <Check className="h-3 w-3 mr-1" />Add
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAdd(false)} className="h-8">
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1.5">Departments (select all that apply)</label>
              <DeptCheckboxes selected={newDepts} onChange={setNewDepts} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Users list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Team Members ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {users.map((user) => {
              const cfg = ROLE_CONFIG[user.role];
              const Icon = cfg.icon;
              const isEditing = editingId === user.id;
              const isActive = user.id === currentUserId;
              const userDepts: Department[] = user.departments?.length
                ? user.departments
                : [user.department ?? 'management'];

              return (
                <div
                  key={user.id}
                  className={`p-3 rounded-lg border ${isActive ? 'bg-blue-50 border-blue-200' : 'bg-white'}`}
                >
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2 items-center">
                        <Icon className="h-5 w-5 text-slate-400 shrink-0" />
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-36 h-7 text-sm"
                        />
                        <Select value={editRole} onValueChange={(v) => setEditRole(v as UserRole)}>
                          <SelectTrigger className="w-28 h-7 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="staff">Staff</SelectItem>
                            <SelectItem value="comms">Comms</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          value={editPin}
                          onChange={(e) => setEditPin(e.target.value)}
                          placeholder="PIN"
                          maxLength={6}
                          className="w-24 h-7 text-sm font-mono"
                        />
                        <div className="flex gap-1 ml-auto">
                          <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={saveEdit}>
                            <Check className="h-3 w-3 text-green-600" />
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setEditingId(null)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 block mb-1.5">Departments</label>
                        <DeptCheckboxes selected={editDepts} onChange={setEditDepts} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <Icon className="h-5 w-5 text-slate-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{user.name}</span>
                          {isActive && <span className="text-xs text-blue-500 font-medium">• Active</span>}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>
                          {userDepts.map((d) => (
                            <Badge key={d} variant="outline" className={`text-xs ${DEPARTMENT_CONFIG[d]?.color ?? 'bg-slate-50'}`}>
                              {DEPARTMENT_CONFIG[d]?.label ?? d}
                            </Badge>
                          ))}
                          {user.pin && <span className="text-xs text-slate-400 ml-1">PIN set</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!isActive && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => { setCurrentUser(user.id); toast.success(`Switched to ${user.name}`); }}
                          >
                            Switch To
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => startEdit(user)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 w-7 p-0 text-red-500 border-red-200 hover:bg-red-50"
                          onClick={() => handleDelete(user)}
                          disabled={users.length === 1}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
