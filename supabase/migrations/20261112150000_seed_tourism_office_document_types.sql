insert into public.workflow_office_document_types (office_role, document_type)
values
  ('tourism_officer', 'Tourism Event or Activity Coordination'),
  ('tourism_officer', 'Tourism Promotion and Marketing'),
  ('tourism_officer', 'Tourist Attraction or Facility Support'),
  ('tourism_officer', 'Tourism Business or Establishment Inquiry'),
  ('tourism_officer', 'Tourism Information and Assistance'),
  ('tourism_officer', 'Other')
on conflict (office_role, document_type) do nothing;

delete from public.workflow_office_document_types
where office_role = 'tourism_officer'
  and document_type not in (
    'Tourism Event or Activity Coordination',
    'Tourism Promotion and Marketing',
    'Tourist Attraction or Facility Support',
    'Tourism Business or Establishment Inquiry',
    'Tourism Information and Assistance',
    'Other'
  );
