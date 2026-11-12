export const TOURISM_OFFICE_ROLE = 'tourism_officer' as const;
export const TOURISM_OFFICE_LABEL = 'Daet Tourism Office';

export const OFFICE_CONFIG = {
  tourism_officer: {
    label: TOURISM_OFFICE_LABEL,
    path: '/workflow/tourism-office',
    categories: [
      'Tourism Event or Activity Coordination',
      'Tourism Promotion and Marketing',
      'Tourist Attraction or Facility Support',
      'Tourism Business or Establishment Inquiry',
      'Tourism Information and Assistance',
      'Other',
    ],
  },
  municipal_treasurer: {
    label: "Municipal Treasurer's Office",
    path: '/workflow/municipal-treasurer',
    categories: [
      'Tax and Payment Documents',
      'Business Permit Fees',
      'Official Receipts',
      'Financial Requests',
      'Other',
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
      'Other',
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
      'Other',
    ],
  },
} as const;

export type OfficeRole = keyof typeof OFFICE_CONFIG;

export type SubmissionDestinationRole = OfficeRole;

export const SUBMISSION_DESTINATION_CONFIG = {
  ...OFFICE_CONFIG,
} as const;

export function getWorkflowDocumentTypeLabel(category: string | null, otherDocumentType?: string | null) {
  if (!category) return 'Unassigned';
  return category === 'Other' && otherDocumentType
    ? `Other — ${otherDocumentType}`
    : category;
}

export const OFFICE_RESPONSIBILITIES = {
  mandatory_approval_clearance: 'Mandatory Approval/Clearance',
  evaluation_verification: 'Evaluation/Verification',
  recommendation: 'Recommendation',
} as const;

export type OfficeResponsibility = keyof typeof OFFICE_RESPONSIBILITIES;
export type OfficeRoutingMode = 'sequential' | 'simultaneous';

export function isOfficeRole(role: string | null): role is OfficeRole {
  return role !== null && Object.prototype.hasOwnProperty.call(OFFICE_CONFIG, role);
}

export function getOfficeFileManagementPath(role: OfficeRole) {
  return `${OFFICE_CONFIG[role].path}/file_management`;
}

export function getOfficeNotificationsPath(role: OfficeRole) {
  return `${OFFICE_CONFIG[role].path}/notifications`;
}

export function getRoleHomePath(role: string | null) {
  if (role === 'system_admin') return '/workflow/admin';
  if (isOfficeRole(role)) return OFFICE_CONFIG[role].path;
  return '/workflow/user';
}
