# Community Canvas Email Notifications

Email notifications should run from Supabase, not GitHub Pages, so the email API key stays private.

## What This Uses

- Supabase Edge Function: `community-canvas-notify`
- Supabase Database Webhook on `public.community_canvas_submissions`
- Resend for email delivery

## Required Supabase Function Secrets

Set these on the `community-canvas-notify` Edge Function:

```text
RESEND_API_KEY=your_resend_api_key
COMMUNITY_CANVAS_WEBHOOK_SECRET=a-long-random-secret
COMMUNITY_CANVAS_NOTIFY_TO=studio@monochromecanvas.com
COMMUNITY_CANVAS_NOTIFY_FROM=Community Canvas <notifications@monochromecanvas.com>
COMMUNITY_CANVAS_ADMIN_URL=https://monochromecanvas.github.io/community-canvas/admin/
COMMUNITY_CANVAS_BUCKET=community-canvas-artwork
```

`COMMUNITY_CANVAS_NOTIFY_FROM` must be a sender/domain that Resend allows. If the
Monochrome Canvas domain is not verified in Resend yet, verify it first or use a
Resend-approved sender while testing.

## Deploy The Function

### Option A: GitHub Actions

This repository includes a manual workflow at:

`.github/workflows/deploy-community-canvas-functions.yml`

Add these GitHub repository secrets first:

```text
SUPABASE_ACCESS_TOKEN
RESEND_API_KEY
COMMUNITY_CANVAS_WEBHOOK_SECRET
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
supabase secrets set COMMUNITY_CANVAS_ADMIN_URL=https://monochromecanvas.github.io/community-canvas/admin/
supabase secrets set COMMUNITY_CANVAS_BUCKET=community-canvas-artwork
```

## Create The Database Webhook

In Supabase:

1. Open **Database** -> **Webhooks**.
2. Create a webhook for table `public.community_canvas_submissions`.
3. Event: `Insert`.
4. Type: HTTP Request.
5. Method: `POST`.
6. URL:

```text
https://marobxcafpzqrriipjdw.supabase.co/functions/v1/community-canvas-notify
```

7. Add header:

```text
x-community-canvas-secret: the-same-value-as-COMMUNITY_CANVAS_WEBHOOK_SECRET
```

8. Add header:

```text
Content-Type: application/json
```

After that, every new pending artwork submission should email the studio review address.
