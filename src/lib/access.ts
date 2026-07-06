'use client';

import { AppUser, UserRole, Department, AccessConfig, ResourceRule } from './types';
import { useOrderStore } from './store';

// ── Resource registry ─────────────────────────────────────────────────────────
// The single source of truth for what can be access-controlled. `defaultRoles`
// (and optional `defaultDepartments`) reproduce today's hard-wired visibility, so
// the app behaves identically until an admin customises the config.
//
// Page resource ids are the nav `href`. Feature ids are prefixed `feature:`.

export interface AccessResource {
  id: string;
  label: string;
  category: string;
  defaultRoles: UserRole[];
  defaultDepartments?: Department[];
}

const ALL: UserRole[] = ['admin', 'manager', 'staff', 'comms'];
const OPS: UserRole[] = ['admin', 'manager'];
const OPS_COMMS: UserRole[] = ['admin', 'manager', 'comms'];
const ADMIN_ONLY: UserRole[] = ['admin'];

export const PAGE_RESOURCES: AccessResource[] = [
  { id: '/',                 label: 'Dashboard',         category: 'Operations',      defaultRoles: ['admin', 'manager', 'staff'] },
  { id: '/overview',         label: 'Overview',          category: 'Operations',      defaultRoles: OPS },
  { id: '/import',           label: 'Import Orders',     category: 'Operations',      defaultRoles: OPS },
  { id: '/listings',         label: 'Listings',          category: 'Operations',      defaultRoles: OPS },
  { id: '/inventory',        label: 'Inventory',         category: 'Operations',      defaultRoles: OPS },
  { id: '/orders/new',       label: 'Create Order',      category: 'Operations',      defaultRoles: OPS },
  { id: '/shipping',         label: 'Batch Shipping',    category: 'Operations',      defaultRoles: OPS },
  { id: '/tracking',         label: 'Tracking',          category: 'Operations',      defaultRoles: ALL },
  { id: '/orders',           label: 'Order Sheet',       category: 'Operations',      defaultRoles: OPS },
  { id: '/historical',       label: 'Historical Orders', category: 'Operations',      defaultRoles: OPS },
  { id: '/packaging',        label: 'Queue',             category: 'Operations',      defaultRoles: ALL },
  { id: '/batches',          label: 'Batches',           category: 'Operations',      defaultRoles: OPS },
  { id: '/recently-deleted', label: 'Recently Deleted',  category: 'Operations',      defaultRoles: OPS },
  { id: '/reports',          label: 'Reports',           category: 'Operations',      defaultRoles: OPS },
  { id: '/eod',              label: 'EOD Report',        category: 'Operations',      defaultRoles: OPS },
  { id: '/notes',            label: 'Messages',          category: 'Comms & Support',  defaultRoles: ALL },
  { id: '/feedback',         label: 'Feedback',          category: 'Comms & Support',  defaultRoles: OPS_COMMS },
  { id: '/returns',          label: 'Returns',           category: 'Comms & Support',  defaultRoles: OPS_COMMS },
  { id: '/replacements',     label: 'Replacements',      category: 'Comms & Support',  defaultRoles: OPS_COMMS },
  { id: '/missing-items',    label: 'Missing Items',     category: 'Comms & Support',  defaultRoles: OPS_COMMS },
  { id: '/hr',               label: 'HR Module',         category: 'People & Admin',   defaultRoles: ALL },
  { id: '/users',            label: 'Users & Roles',     category: 'People & Admin',   defaultRoles: ADMIN_ONLY },
  { id: '/settings',         label: 'Settings',          category: 'People & Admin',   defaultRoles: ADMIN_ONLY },
];

export const FEATURE_RESOURCES: AccessResource[] = [
  { id: 'feature:buyer-inbox', label: 'Buyer Inbox (email/messages)', category: 'Features', defaultRoles: ['admin', 'comms'], defaultDepartments: ['comms'] },
];

export const ACCESS_RESOURCES: AccessResource[] = [...PAGE_RESOURCES, ...FEATURE_RESOURCES];
const RESOURCE_BY_ID = new Map(ACCESS_RESOURCES.map((r) => [r.id, r]));

// Resource ids that must always keep admin access — an admin can't lock themselves
// (or the org) out of user/permission management.
export const LOCKED_ADMIN_RESOURCES = ['/settings', '/users'];

// ── Rule resolution ────────────────────────────────────────────────────────────

/** The effective rule for a resource: the stored override, or the registry default. */
export function ruleFor(resourceId: string, config?: AccessConfig | null): ResourceRule {
  const stored = config?.resources?.[resourceId];
  if (stored) return stored;
  const res = RESOURCE_BY_ID.get(resourceId);
  return {
    roles: res?.defaultRoles ?? [],
    departments: res?.defaultDepartments ?? [],
    allowUsers: [],
    denyUsers: [],
  };
}

function userRoles(user: Pick<AppUser, 'role' | 'roles'>): UserRole[] {
  return user.roles?.length ? user.roles : [user.role];
}
function userDepts(user: Pick<AppUser, 'department' | 'departments'>): Department[] {
  return user.departments?.length ? user.departments : (user.department ? [user.department] : []);
}

/** Can this user access the resource, under the given config (falling back to defaults)? */
export function can(user: AppUser | null | undefined, resourceId: string, config?: AccessConfig | null): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;              // admins are never locked out
  const rule = ruleFor(resourceId, config);
  if (rule.denyUsers?.includes(user.id)) return false; // hard revoke wins
  if (rule.allowUsers?.includes(user.id)) return true;
  if (userRoles(user).some((r) => rule.roles?.includes(r))) return true;
  if (userDepts(user).some((d) => rule.departments?.includes(d))) return true;
  return false;
}

// Priority order for choosing a landing page: the first one the user can access.
const LANDING_PRIORITY = ['/', '/overview', '/notes', '/tracking', '/packaging', '/hr', '/returns', '/feedback'];

/** The best landing path for a user given their access — where to send them on sign-in / redirect. */
export function landingPathFor(user: AppUser | null | undefined, config?: AccessConfig | null): string {
  if (!user) return '/';
  for (const href of LANDING_PRIORITY) if (can(user, href, config)) return href;
  const firstPage = PAGE_RESOURCES.find((p) => can(user, p.id, config));
  return firstPage?.id ?? '/notes';
}

/** Map a pathname (possibly a deep route) to the page resource id that governs it. */
export function resourceIdForPath(pathname: string): string | null {
  if (pathname === '/') return '/';
  // Longest matching href wins so '/orders/new' beats '/orders'.
  let best: string | null = null;
  for (const p of PAGE_RESOURCES) {
    if (p.id === '/') continue;
    if (pathname === p.id || pathname.startsWith(p.id + '/')) {
      if (!best || p.id.length > best.length) best = p.id;
    }
  }
  return best;
}

// ── React hook ─────────────────────────────────────────────────────────────────

export function useAccess() {
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const config = useOrderStore((s) => s.accessControl);
  const user = users.find((u) => u.id === currentUserId) ?? null;
  return {
    user,
    config,
    can: (resourceId: string) => can(user, resourceId, config),
    landingPath: () => landingPathFor(user, config),
  };
}
