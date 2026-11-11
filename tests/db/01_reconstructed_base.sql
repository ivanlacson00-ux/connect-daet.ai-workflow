-- RECONSTRUCTED base tables that are NOT created by any migration in the repo
-- (they were created by hand in the Supabase dashboard before 2026-09-14).
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, full_name text, role text not null default 'user',
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.workflow_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  title text, description text, category text, document_type text,
  file_name text, file_type text, file_size bigint, file_url text,
  status text not null default 'pending',
  approver_comments text, admin_comments text, rejection_comment text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
insert into storage.buckets(id, name, public) values ('workflow_uploads','workflow_uploads', false);
