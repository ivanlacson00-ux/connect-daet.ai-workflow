do $$
begin
  update storage.buckets
  set allowed_mime_types = array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'application/zip'
  ]
  where id = 'workflow_uploads';

  if not found then
    raise exception 'The workflow_uploads storage bucket must exist before restricting its file types';
  end if;
end;
$$;
