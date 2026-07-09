# Community Canvas Email Notifications

Email notifications should run from Supabase, not GitHub Pages, so the email API key stays private.

## What This Uses

- Supabase Edge Function: `community-canvas-notify`
- Supabase `pg_net` trigger on `public.community_canvas_submissions`
- Resend for email delivery

## Required Supabase Function Secrets

Set these on the `community-canvas-notify` Edge Function:

```text
RESEND_API_KEY=your_resend_api_key
COMMUNITY_CANVAS_WEBHOOK_SECRET=a-long-random-secret
COMMUNITY_CANVAS_NOTIFY_TO=studio@monochromecanvas.com
COMMUNITY_CANVAS_NOTIFY_FROM=Community Canvas <notifications@monochromecanvas.com>
COMMUNITY_CANVAS_ARTIST_EMAILS_ENABLED=false
COMMUNITY_CANVAS_ADMIN_URL=https://monochromecanvas.github.io/community-canvas/admin/
COMMUNITY_CANVAS_GALLERY_URL=https://monochromecanvas.github.io/community-canvas/
COMMUNITY_CANVAS_BUCKET=community-canvas-artwork
```

`COMMUNITY_CANVAS_NOTIFY_FROM` must be a sender/domain that Resend allows. If the
Monochrome Canvas domain is not verified in Resend yet, verify it first or use a
Resend-approved sender while testing.

`COMMUNITY_CANVAS_ARTIST_EMAILS_ENABLED` controls artist-facing emails:

- `false`: studio receives pending-submission alerts only.
- `true`: artists also receive a submission receipt and an approval/denial update.

Keep this set to `false` until `monochromecanvas.com` or a sending subdomain is verified
in Resend, because artist emails go to arbitrary public recipients.

## Deploy The Function

### Option A: GitHub Actions

This repository includes a manual workflow at:

`.github/workflows/deploy-community-canvas-functions.yml`

Add these GitHub repository secrets first:

```text
SUPABASE_ACCESS_TOKEN
RESEND_API_KEY
COMMUNITY_CANVAS_WEBHOOK_SECRET
COMMUNITY_CANVAS_NOTIFY_TO
COMMUNITY_CANVAS_NOTIFY_FROM
COMMUNITY_CANVAS_ARTIST_EMAILS_ENABLED
```

Then open **Actions** -> **Deploy Community Canvas Supabase Functions** -> **Run workflow**.

### Option B: Local Supabase CLI

From the `community-canvas` folder, deploy:

```bash
supabase functions deploy community-canvas-notify
supabase secrets set RESEND_API_KEY=...
supabase secrets set COMMUNITY_CANVAS_WEBHOOK_SECRET=...
supabase secrets set COMMUNITY_CANVAS_NOTIFY_TO=studio@monochromecanvas.com
supabase secrets set 'COMMUNITY_CANVAS_NOTIFY_FROM=Community Canvas <notifications@monochromecanvas.com>'
supabase secrets set COMMUNITY_CANVAS_ARTIST_EMAILS_ENABLED=false
supabase secrets set COMMUNITY_CANVAS_ADMIN_URL=https://monochromecanvas.github.io/community-canvas/admin/
supabase secrets set COMMUNITY_CANVAS_GALLERY_URL=https://monochromecanvas.github.io/community-canvas/
supabase secrets set COMMUNITY_CANVAS_BUCKET=community-canvas-artwork
```

## Create The Database Trigger

The live site uses a database trigger powered by Supabase `pg_net`. It sends new
pending submissions and approved/denied status changes to the Edge Function.

Run SQL like this in Supabase, using the same secret as
`COMMUNITY_CANVAS_WEBHOOK_SECRET`:

```sql
create extension if not exists pg_net;

create or replace function public.community_canvas_notify_submission()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
begin
  perform net.http_post(
    url := 'https://marobxcafpzqrriipjdw.supabase.co/functions/v1/community-canvas-notify',
    body := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', to_jsonb(NEW),
      'old_record', case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-community-canvas-secret', 'the-same-value-as-COMMUNITY_CANVAS_WEBHOOK_SECRET'
    ),
    timeout_milliseconds := 5000
  );
  return NEW;
end;
$$;

drop trigger if exists community_canvas_notify_on_insert on public.community_canvas_submissions;
create trigger community_canvas_notify_on_insert
after insert on public.community_canvas_submissions
for each row
execute function public.community_canvas_notify_submission();

drop trigger if exists community_canvas_notify_on_status_update on public.community_canvas_submissions;
create trigger community_canvas_notify_on_status_update
after update of status on public.community_canvas_submissions
for each row
when (old.status is distinct from new.status and new.status in ('approved', 'denied'))
execute function public.community_canvas_notify_submission();
```

After that, every new pending artwork submission should email the studio review address.
If artist emails are enabled, status changes to `approved` or `denied` should email the
submitting artist.
