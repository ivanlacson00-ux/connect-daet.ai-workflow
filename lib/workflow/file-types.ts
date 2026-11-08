const MIME_TYPES_BY_EXTENSION = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  zip: 'application/zip',
} as const;

export type WorkflowFileExtension = keyof typeof MIME_TYPES_BY_EXTENSION;

const DOCUMENT_EXTENSIONS: WorkflowFileExtension[] = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'jpg', 'jpeg', 'png',
];

const ATTACHMENT_EXTENSIONS: WorkflowFileExtension[] = [
  ...DOCUMENT_EXTENSIONS,
  'zip',
];

export const WORKFLOW_DOCUMENT_ACCEPT = DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`).join(',');
export const WORKFLOW_ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export function getWorkflowFileMimeType(fileName: string): string | null {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (!extension || !Object.prototype.hasOwnProperty.call(MIME_TYPES_BY_EXTENSION, extension)) {
    return null;
  }
  return MIME_TYPES_BY_EXTENSION[extension as WorkflowFileExtension];
}

export function getWorkflowFileTypeError(fileName: string, allowZip = true): string | null {
  const mimeType = getWorkflowFileMimeType(fileName);
  if (mimeType && (allowZip || mimeType !== MIME_TYPES_BY_EXTENSION.zip)) return null;

  const acceptedExtensions = allowZip
    ? ATTACHMENT_EXTENSIONS
    : DOCUMENT_EXTENSIONS;
  const formattedExtensions = acceptedExtensions
    .map((extension) => extension.toUpperCase())
    .join(', ');

  return `"${fileName}" is not an allowed file type. Accepted formats: ${formattedExtensions}.`;
}

export function getWorkflowFilesTypeError(files: File[], allowZip = true): string | null {
  for (const file of files) {
    const error = getWorkflowFileTypeError(file.name, allowZip);
    if (error) return error;
  }
  return null;
}
