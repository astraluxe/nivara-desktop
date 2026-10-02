# Retired Edge Functions (2 Oct 2026)

The hosted adris.tech plan was retired: the app is free and runs only on the AI the user connects.
Every Supabase Edge Function that spent adris.tech's `GEMINI_API_KEY`, or took a payment for a plan,
was replaced in place by a stub that refuses. They keep their names, so installed copies of older
builds get a clear message instead of a 404.

| Function | Was | Now | Source before retirement |
|---|---|---|---|
| `get-session-key` | handed the real Gemini key to the app for 24h | 410 | `NIVARA/supabase/functions/get-session-key` (git history) |
| `krew-stream` | streamed chat on our Gemini key | 410 | `krew-stream.v40.ts` here |
| `generate-image` | made images on our Gemini key | **NOT YET DEPLOYED** — stub is in `NIVARA/supabase/functions/generate-image`; the deploy was blocked by a permission check on 2 Oct 2026. Until it ships, only accounts on a paid `plan` (today: the owner's own) can spend on it | `NIVARA/supabase/functions/generate-image` (git history) |
| `automation-cloud-runner` | ran cloud automations on our Gemini key every 5 min (cron job 2) | 410, cron job unscheduled | `automation-cloud-runner.v16.ts` here |
| `razorpay-create-subscription` | started a paid plan checkout | 410 | `NIVARA/supabase/functions/razorpay-create-subscription` (git history) |
| `mesh-create-order` | sold Mesh passes | 410 | `NIVARA/supabase/functions/mesh-create-order` (git history) |
| `checkout-status` | reported checkout open | reports closed | `NIVARA/supabase/functions/checkout-status` (git history) |

Left running on purpose: `razorpay-webhook`, `razorpay-verify-payment` and `razorpay-subscription`.
They take no new money, and keeping them up means any event about the two already-cancelled
subscriptions is still recorded properly.

**Still to do by the owner (not possible from code):** delete the `GEMINI_API_KEY` secret in Supabase
(Project Settings → Edge Functions → Secrets), and **revoke that key in Google AI Studio**. Until
1.89.0, every signed-in app downloaded the real key for 24 hours at a time, so treat it as exposed.
