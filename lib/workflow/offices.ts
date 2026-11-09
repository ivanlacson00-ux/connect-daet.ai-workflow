export const OFFICE_CONFIG = {
  municipal_treasurer: {
    label: "Municipal Treasurer's Office",
    path: '/workflow/municipal-treasurer',
    categories: [
      'Tax and Payment Documents',
      'Business Permit Fees',
      'Official Receipts',
      'Financial Requests',
    ],
  },
  mayor_office: {
    label: "Mayor's Office",
    path: '/workflow/mayor',
    categories: [
      'Executive Requests',
      'Complaints',
      'Mayoral Endorsements',
      'General Correspondence',
    ],
  },
  sangguniang_bayan: {
    label: 'Sangguniang Bayan Office',
    path: '/workflow/sangguniang-bayan',
    categories: [
      'Proposed Ordinances',
      'Proposed Resolutions',
      'Legislative Requests',
      'Session-Related Submissions',
    ],
  },
} as const;

export type OfficeRole = keyof typeof OFFICE_CONFIG;

export function isOfficeRole(role: string | null): role is OfficeRole {
  return role !== null && Object.prototype.hasOwnProperty.call(OFFICE_CONFIG, role);
}

export function getRoleHomePath(role: string | null) {
  if (role === 'admin') return '/workflow/admin';
  if (role === 'approver') return '/workflow/approver';
  if (isOfficeRole(role)) return OFFICE_CONFIG[role].path;
  return '/workflow/user';
}
