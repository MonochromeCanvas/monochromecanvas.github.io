create extension if not exists pgcrypto;

create table if not exists public.community_canvas_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

insert into public.community_canvas_admins (email)
values ('studio@monochromecanvas.com')
on conflict (email) do nothing;

alter table public.community_canvas_admins enable row level security;

drop policy if exists "Admins can read own admin record" on public.community_canvas_admins;
create policy "Admins can read own admin record"
on public.community_canvas_admins
for select
to authenticated
using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create or replace function public.community_canvas_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.community_canvas_admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

grant execute on function public.community_canvas_is_admin() to authenticated;

create table if not exists public.community_canvas_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  featured boolean not null default false,
  display_order integer not null default 0,
  heart_count integer not null default 0 check (heart_count >= 0),
  title text not null default 'Untitled',
  artist_email text not null,
  credit_mode text not null default 'anonymous' check (credit_mode in ('anonymous', 'public')),
  artist_name text,
  social text,
  website text,
  location: text,
  artwork_note text,
  endorsement text,
  image_path text not null,
  image_mime_type text,
  image_size integer,
  paper_confirmed boolean not null default false,
  artwork_methods text[] not null default '{}',
  artwork_method_other text,
  mailing_list_opt_in boolean not null default false,
  permission_confirmed boolean not null default false,
  source_url text,
  user_agent text,
  admin_notes text,
  reviewed_at timestamptz,
  reviewed_by text
);

create or replace function public.community_canvas_set_updated_at()
returns trigger
language plpgsql
set_search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists community_canvas_set_updated_at on public.community_canvas_submissions;
create trigger community_canvas_set_updated_at
before update on public.community_canvas_submissions
for each row
execute function public.community_canvas_set_updated_at();

alter table public.community_canvas_submissions enable row level security;

alter table public.community_canvas_submissions
  add column if not exists paper_confirmed boolean not null default false,
  add column if not exists artwork_methods text[] not null default '{}',
  add column if not exists artwork_method_other text,
  add column if not exists mailing_list_opt_in boolean not null default false;

revoke select on public.community_canvas_submissions from anon;
grant insert on public.community_canvas_submissions to anon;
grant select, insert, update, delete on public.community_canvas_submissions to authenticated;

drop policy if exists "Anyone can submit pending artwork" on public.community_canvas_submissions;
create policy "Anyone can submit pending artwork"
on public.community_canvas_submissions
for insert
to anon, authenticated
with check (
  status = 'pending'
  and featured = false
  and heart_count = 0
  and paper_confirmed = true
  and array_length(artwork_methods, 1) is not null
  and permission_confirmed = true
  and artist_email is not null
  and image_path like 'pending/%'
);

drop policy if exists "Anyone can view approved artwork" on public.community_canvas_submissions;

drop policy if exists "Studio admins can view all artwork" on public.community_canvas_submissions;
create policy "Studio admins can view all artwork"
on public.community_canvas_submissions
for select
to authenticated
using (public.community_canvas_is_admin());

drop policy if exists "Studio admins can update artwork" on public.community_canvas_submissions;
create policy "Studio admins can update artwork"
on public.community_canvas_submissions
for update
to authenticated
using (public.community_canvas_is_admin())
with check (public.community_canvas_is_admin());

drop policy if exists "Studio admins can delete artwork" on public.community_canvas_submissions;
create policy "Studio admins can delete artwork"
on public.community_canvas_submissions
for delete
to authenticated
using (public.community_canvas_is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-canvas-artwork',
  'community-canvas-artwork',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can upload pending community canvas images" on storage.objects;
create policy "Anyone can upload pending community canvas images"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'community-canvas-artwork'
  and (storage.foldername(name))[1] = 'pending'
);

drop policy if exists "Anyone can read community canvas images" on storage.objects;
create policy "Anyone can read community canvas images"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'community-canvas-artwork');

drop policy if exists "Studio admins can read community canvas images" on storage.objects;
create policy "Studio admins can read community canvas images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'community-canvas-artwork'
  and public.community_canvas_is_admin()
);

drop policy if exists "Studio admins can insert community canvas images" on storage.objects;
create policy "Studio admins can insert community canvas images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'community-canvas-artwork'
  and public.community_canvas_is_admin()
);

drop policy if exists "Studio admins can update community canvas images" on storage.objects;
create policy "Studio admins can update community canvas images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'community-canvas-artwork'
  and public.community_canvas_is_admin()
)
with check (
  bucket_id = 'community-canvas-artwork'
  and public.community_canvas_is_admin()
);

drop policy if exists "Studio admins can delete community canvas images" on storage.objects;
create policy "Studio admins can delete community canvas images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'community-canvas-artwork'
  and public.community_canvas_is_admin()
);

create or replace function public.community_canvas_increment_heart(submission_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  update public.community_canvas_submissions
  set heart_count = heart_count + 1
  where id = submission_id
    and status = 'approved'
  returning heart_count into next_count;

  if next_count is null then
    raise exception 'Submission is not available for hearts.';
  end if;

  return next_count;
end;
$$;

grant execute on function public.community_canvas_increment_heart(uuid) to anon, authenticated;

create or replace view public.community_canvas_public_gallery as
select
  id,
  created_at,
  updated_at,
  featured,
  display_order,
  heart_count,
  title,
  credit_mode,
  artist_name,
  social,
  website,
  location,
  artwork_note,
  endorsement,
  image_path,
  artwork_methods,
  artwork_method_other
from public.community_canvas_submissions
where status = 'approved';

grant select on public.community_canvas_public_gallery to anon, authenticated;
