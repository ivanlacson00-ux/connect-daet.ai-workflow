import type { User } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export type WorkflowRole = 'user' | 'approver' | 'external_approver' | 'admin';

export type WorkflowAccess = {
  user: User;
  roles: WorkflowRole[];
  officeIds: string[];
};

const ROLE_PRIORITY: WorkflowRole[] = ['approver', 'external_approver', 'admin', 'user'];
const WORKFLOW_ROLES = new Set<string>(ROLE_PRIORITY);

function isWorkflowRole(role: unknown): role is WorkflowRole {
  return typeof role === 'string' && WORKFLOW_ROLES.has(role);
}

export function getPrimaryWorkflowRole(roles: WorkflowRole[]): WorkflowRole | null {
  return ROLE_PRIORITY.find((role) => roles.includes(role)) ?? null;
}

export function getWorkflowHomePath(role: WorkflowRole | null): string {
  switch (role) {
    case 'approver':
      return '/workflow/approver';
    case 'external_approver':
      return '/workflow/office';
    case 'admin':
      return '/workflow/admin';
    case 'user':
      return '/workflow/user';
    default:
      return '/login?access=unassigned';
  }
}

export async function getCurrentWorkflowAccess(
  supabase: SupabaseClient
): Promise<WorkflowAccess | null> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return null;

  const { data: grants, error: grantsError } = await supabase
    .from('role_grants')
    .select('role')
    .eq('profile_id', userData.user.id)
    .is('revoked_at', null);
  if (grantsError) throw grantsError;

  const roles = (grants ?? [])
    .map((grant) => grant.role)
    .filter((role, index, all): role is WorkflowRole => isWorkflowRole(role) && all.indexOf(role) === index);

  let officeIds: string[] = [];
  if (roles.includes('external_approver')) {
    const { data: memberships, error: membershipError } = await supabase
      .from('office_memberships')
      .select('office_id')
      .eq('profile_id', userData.user.id)
      .is('ended_at', null);
    if (membershipError) throw membershipError;
    officeIds = (memberships ?? []).map((membership) => membership.office_id);
  }

  return { user: userData.user, roles, officeIds };
}
