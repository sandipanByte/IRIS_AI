# IRIS AI

IRIS AI is a browser-based visual intelligence workspace for hand gestures,
movement and common objects. Sign in to keep a private activity history.

## What it does

- Email/password sign-up and sign-in, managed by Supabase Auth
- Live webcam hand tracking, gesture recognition and motion trails
- Optional object recognition using a browser-loaded COCO-SSD model
- Optional spoken responses using the browser's speech synthesis
- User-specific recent activity, protected by Supabase row-level security
- Vercel serverless configuration endpoint; no video is uploaded

Camera frames and recognition are processed in the user's browser. Only short
text activity descriptions are stored in Supabase for the signed-in user.

## Set up the backend

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql).
3. In Supabase Authentication settings, enable email/password sign-in and set
   the site URL and redirect URLs to your local and deployed app URLs.
4. In Vercel, add these environment variables for Preview and Production:
   - `SUPABASE_URL` — the project URL from Supabase API settings
   - `SUPABASE_ANON_KEY` — the project's public anon key (or use
     `SUPABASE_PUBLISHABLE_KEY` for the newer key format)

The public anon/publishable key is delivered to the browser. This is expected:
the database is protected by RLS. Never put a Supabase `service_role` or secret
key in these variables or in browser code.

## Run and deploy

Import this repository into Vercel, or run `npx vercel` from the project
directory and follow the prompts. Add the environment variables above in the
Vercel project settings, then deploy. After the first deployment, set the exact
Vercel domain in Supabase Auth's allowed redirect URLs.

To run locally with Vercel's serverless function support:

```sh
npx vercel dev
```

Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the local environment before
starting the dev server. The app requires HTTPS (or localhost) for camera
access. For deployed use, approve the camera permission in your browser.

## Privacy and safety

The browser asks for camera permission only after the user selects **Start
camera**. IRIS does not request microphone access. Video is not sent to IRIS,
Vercel or Supabase; only recognized text events are saved to the signed-in
account. Each user can read only their own activity, enforced by database RLS.
      