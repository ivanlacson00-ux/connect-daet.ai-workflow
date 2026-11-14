export interface WorkflowRevisionFile {
  id: string;
  logicalFileId: string;
  fileRole: 'primary' | 'supporting';
  fileName: string;
  storagePath: string;
  fileType: string | null;
  fileSize: number;
  changeKind: 'added' | 'replaced' | 'carried' | 'removed';
  createdAt: string;
}

export interface WorkflowSubmissionRevision {
  id: string;
  revisionNo: number;
  createdAt: string;
  submitterMessage: string | null;
  formSnapshot: Record<string, unknown> | null;
  backfillQuality: 'complete' | 'partial';
  files: WorkflowRevisionFile[];
}

export interface WorkflowChangeRequest {
  id: string;
  requestedByOffice: string;
  message: string;
  againstRevisionId: string;
  status: 'open' | 'fulfilled' | 'abandoned';
  sourceAuditEventId: string | null;
  backfillQuality: 'complete' | 'partial';
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRevisionAuditEvent {
  id: string;
  actionType: string;
  comments: string | null;
  createdAt: string;
}

export interface WorkflowRevisionHistory {
  changeRequestRepairNeeded: boolean;
  revisions: WorkflowSubmissionRevision[];
  changeRequests: WorkflowChangeRequest[];
  auditEvents: WorkflowRevisionAuditEvent[];
}

export function getCurrentWorkflowRevisionFiles(
  history: WorkflowRevisionHistory | null,
): WorkflowRevisionFile[] {
  const latestRevision = history?.revisions.at(-1);
  return latestRevision?.files.filter((file) => file.changeKind !== 'removed') ?? [];
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (record: JsonRecord, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(`Revision history field "${key}" is invalid.`);
  return value;
};

const nullableString = (record: JsonRecord, key: string): string | null => {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`Revision history field "${key}" is invalid.`);
  return value;
};

const requiredNumber = (record: JsonRecord, key: string): number => {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Revision history field "${key}" is invalid.`);
  }
  return value;
};

const requiredArray = (record: JsonRecord, key: string): unknown[] => {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`Revision history field "${key}" is invalid.`);
  return value;
};

const nullableRecord = (record: JsonRecord, key: string): JsonRecord | null => {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new Error(`Revision history field "${key}" is invalid.`);
  return value;
};

const isChangeKind = (value: string): value is WorkflowRevisionFile['changeKind'] =>
  value === 'added' || value === 'replaced' || value === 'carried' || value === 'removed';

const parseRevisionFile = (value: unknown): WorkflowRevisionFile => {
  if (!isRecord(value)) throw new Error('Revision history contains an invalid file record.');

  const fileRole = requiredString(value, 'file_role');
  if (fileRole !== 'primary' && fileRole !== 'supporting') {
    throw new Error('Revision history contains an unsupported file role.');
  }

  const changeKind = requiredString(value, 'change_kind');
  if (!isChangeKind(changeKind)) {
    throw new Error('Revision history contains an unsupported file change.');
  }

  return {
    id: requiredString(value, 'id'),
    logicalFileId: requiredString(value, 'logical_file_id'),
    fileRole,
    fileName: requiredString(value, 'file_name'),
    storagePath: requiredString(value, 'storage_path'),
    fileType: nullableString(value, 'file_type'),
    fileSize: requiredNumber(value, 'file_size'),
    changeKind,
    createdAt: requiredString(value, 'created_at'),
  };
};

const parseRevision = (value: unknown): WorkflowSubmissionRevision => {
  if (!isRecord(value)) throw new Error('Revision history contains an invalid revision record.');

  const backfillQuality = requiredString(value, 'backfill_quality');
  if (backfillQuality !== 'complete' && backfillQuality !== 'partial') {
    throw new Error('Revision history contains an unsupported backfill quality.');
  }

  return {
    id: requiredString(value, 'id'),
    revisionNo: requiredNumber(value, 'revision_no'),
    createdAt: requiredString(value, 'created_at'),
    submitterMessage: nullableString(value, 'submitter_message'),
    formSnapshot: nullableRecord(value, 'form_snapshot'),
    backfillQuality,
    files: requiredArray(value, 'files').map(parseRevisionFile),
  };
};

const parseChangeRequest = (value: unknown): WorkflowChangeRequest => {
  if (!isRecord(value)) throw new Error('Revision history contains an invalid change request.');

  const status = requiredString(value, 'status');
  if (status !== 'open' && status !== 'fulfilled' && status !== 'abandoned') {
    throw new Error('Revision history contains an unsupported change-request status.');
  }

  const backfillQuality = requiredString(value, 'backfill_quality');
  if (backfillQuality !== 'complete' && backfillQuality !== 'partial') {
    throw new Error('Revision history contains an unsupported backfill quality.');
  }

  return {
    id: requiredString(value, 'id'),
    requestedByOffice: requiredString(value, 'requested_by_office'),
    message: requiredString(value, 'message'),
    againstRevisionId: requiredString(value, 'against_revision_id'),
    status,
    sourceAuditEventId: nullableString(value, 'source_audit_event_id'),
    backfillQuality,
    createdAt: requiredString(value, 'created_at'),
    updatedAt: requiredString(value, 'updated_at'),
  };
};

const parseAuditEvent = (value: unknown): WorkflowRevisionAuditEvent => {
  if (!isRecord(value)) throw new Error('Revision history contains an invalid audit event.');
  return {
    id: requiredString(value, 'id'),
    actionType: requiredString(value, 'action_type'),
    comments: nullableString(value, 'comments'),
    createdAt: requiredString(value, 'created_at'),
  };
};

export function parseWorkflowRevisionHistory(value: unknown): WorkflowRevisionHistory {
  if (!isRecord(value)) throw new Error('The revision-history response is invalid.');

  if (!isRecord(value.submission) || typeof value.submission.change_request_repair_needed !== 'boolean') {
    throw new Error('Revision history is missing its submission state.');
  }

  return {
    changeRequestRepairNeeded: value.submission.change_request_repair_needed,
    revisions: requiredArray(value, 'revisions').map(parseRevision),
    changeRequests: requiredArray(value, 'change_requests').map(parseChangeRequest),
    auditEvents: requiredArray(value, 'audit_events').map(parseAuditEvent),
  };
}
