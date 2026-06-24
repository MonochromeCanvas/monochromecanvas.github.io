# Recycled Studio Paper Gallery Supabase Setup

This makes the GitHub Pages gallery work as a real submission and approval system.

## 1. Create a Supabase project

Create a project at `https://supabase.com`, then copy:

- Project URL
- Project anon public key

Paste those into `config.js`:

```js
window.COMMUNITY_CANVAS_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-PUBLIC-KEY",
  artworkBucket: "community-canvas-artwork",
  adminEmail: "studio@monochromecanvas.com"
};
```

The anon public key is designed to be visible in browser code. The database rules in the SQL file control what visitors and admins can actually do.

## 2. Install the database/storage setup

In Supabase, open SQL Editor and run:

`supabase/community-canvas-schema.sql`

That creates:

- `community_canvas_submissions`
- `community_canvas_admins`
- Storage bucket `community-canvas-artwork`
- Public submit rules
- Public approved-gallery rules
- Private admin review rules
- Heart-count function

## 3. Confirm admin access

The setup file adds:

`studio@monochromecanvas.com`

as an approved admin email. Add another admin with:

```sql
insert into public.community_canvas_admins (email)
values ('your-email@example.com')
on conflict (email) do nothing;
```

## 4. Configure Auth URL settings

In Supabase Auth URL settings, add:

`https://monochromecanvas.github.io/community-canvas/admin/`

as an allowed redirect URL.

## 5. Use the dashboard

Public submission page:

`https://monochromecanvas.github.io/community-canvas/submit/`

Private review dashboard:

`https://monochromecanvas.github.io/community-canvas/admin/`

You sign in by email link. Only emails listed in `community_canvas_admins` can see pending submissions.

## Notes

Pending submissions do not appear in the public gallery. They only appear after an admin clicks Approve.

The storage bucket is public so approved images can render on GitHub Pages without a server. Pending images are not linked publicly, but their unguessable storage paths are technically public if someone has the exact URL. For a stricter version, use a private pending bucket plus an Edge Function to move approved images into a public bucket.
