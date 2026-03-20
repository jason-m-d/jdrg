# Email Scan Improvements Plan

This document describes the planned improvements to Crosby's email scanning system. Implement these in order — each phase is independent but they build toward a better overall system.

---

## Background: What We Know

After reviewing the live DB and Gmail inbox together, here's the confirmed state of the current system:

- Email scan cron runs **hourly** (`0 * * * *` in vercel.json)
- Scans land in `email_scans` table, threads in `email_threads`, extracted tasks in `action_items` (source = 'email')
- Thread state tracked in `email_threads`: `last_sender`, `last_sender_email`, `needs_response`, `response_detected`, `direction`
- Action items have a `source_id` column (should be the gmail_thread_id) and `due_date`
- The system does **not** analyze outbound emails for follow-up tracking

**Confirmed gaps from live data:**
1. Duplicate action items created across scan passes for the same thread
2. Compliance deadline dates not extracted into `due_date` even when mentioned in email body
3. No outbound follow-up tracking — if you send an email waiting for a reply, nothing tracks it
4. "Delivery failure" replies (e.g. "can't open file") not detected as needing action
5. Email scan only runs hourly — real-time events (quick back-and-forth, time-sensitive replies) are missed

---

## Phase 1: Fix Duplicate Action Items

**Problem:** The same thread gets scanned every hour. If it still looks actionable, a new action item gets created instead of updating the existing one.

**Fix:** Before inserting a new action item from email, check if one already exists for that thread.

### Changes
- In the email-scan action item insertion logic, query `action_items` where `source = 'email'` AND `source_id = gmail_thread_id` AND `status != 'completed'`
- If a match exists: update the existing row (`updated_at`, `priority`, `description`) instead of inserting
- If no match: insert as today

### Migration needed
None — `source_id` column already exists on `action_items`. Just need to confirm it's being populated with the `gmail_thread_id` (check the email-scan code — it may already be set).

---

## Phase 2: Extract Due Dates from Email Body

**Problem:** Compliance notices, deadline emails, and time-sensitive requests arrive with dates in the body ("must be replaced by August 2026", "due by end of quarter") but `due_date` is left null.

**Fix:** Update the AI extraction prompt to explicitly instruct the model to look for and extract dates.

### Changes
- In the action item extraction prompt (in `src/app/api/cron/email-scan/route.ts`), add explicit instruction: "If the email mentions a deadline, due date, expiry date, or compliance deadline, extract it as an ISO date string (YYYY-MM-DD) for the due_date field. Look for phrases like 'by [date]', 'before [date]', 'deadline', 'expires', 'must be completed by', 'required by'."
- Add `due_date` to the JSON schema returned by the extraction call
- Map it to the `due_date` column on insert/update

---

## Phase 3: Detect Delivery Failure Replies

**Problem:** When someone replies saying they couldn't open, receive, or access something you sent, the system sees it as a normal inbound reply and moves on. But the ball is back in your court.

**Real example:** Pete replied "can't open file" to the Equipment for Sale thread. No action item was created. You happened to notice it yourself.

**Fix:** Add a delivery failure flag to the existing AI extraction prompt — don't use a keyword list, which is fragile. People phrase this in a million ways ("says access denied", "getting an error when I click", "it won't download"). Since we're already running an AI pass on every email, just add an instruction.

### Changes
- Add to the action item extraction prompt: "If this reply indicates the sender had trouble receiving, opening, or accessing something you sent (broken link, file they couldn't open, attachment they didn't receive, access denied error, etc.), set `delivery_failure: true` in your response."
- Add `delivery_failure` as a boolean field to the extraction JSON schema
- If `delivery_failure: true`: create an action item titled "Resend [attachment/link] to [sender name]" with high priority and `due_date = today`, and set `needs_response = true` on the thread

---

## Phase 4: Outbound Follow-Up Tracking

**Problem:** When you send an email, nothing tracks that you're waiting for a reply. If someone doesn't respond to something important, you won't hear about it until you notice it yourself.

**Important context:** Outbound emails are already being fetched. `fetchEmails()` in `src/lib/gmail.ts` uses no label filter, so it returns inbox + sent. The `isFromJason` check in the email-scan route already identifies your outbound messages and updates thread state. They're just not being analyzed for "am I waiting on a reply?"

**Fix:** When an outbound message is identified, run an AI check to determine if it expects a reply, and track it.

### Changes

**New column on `email_threads`:** Add `waiting_for_reply_since timestamptz` — set when you send an outbound message that expects a reply. Cleared when an inbound reply arrives.

```sql
ALTER TABLE email_threads ADD COLUMN waiting_for_reply_since timestamptz;
```

**Detection logic — two paths depending on whether the webhook (Phase 5) is active:**

**Path A — Webhook active (real-time mode):**
Each email (inbound or outbound) already triggers a Pub/Sub notification. When the webhook endpoint processes a message and sees it's from Jason, run the `expects_reply` check as part of that same AI call — not a separate one. One webhook fire, one AI call, handles thread state update + `expects_reply` check together. No extra cost.

**Path B — Webhook not active (hourly fallback mode):**
Don't make a separate AI call per outbound email. Instead, batch all outbound emails from the scan window into the existing extraction prompt. Add an instruction: "For outbound emails from Jason, also return `expects_reply: true/false`." This adds zero extra API calls — it's just an extra field in the existing batch extraction.

**If `expects_reply: true`:** Set `waiting_for_reply_since = now()` on the thread.

**When an inbound reply arrives:** Clear `waiting_for_reply_since = null` on the thread (add this to the existing inbound processing branch).

**Nudge integration:** The nudge cron already has an "unanswered email" section. Extend it to also pick up threads where `waiting_for_reply_since` is set and it's been > 3 days. Surface as "Still waiting on [person] re: [subject]".

### Migration needed
```sql
ALTER TABLE email_threads ADD COLUMN waiting_for_reply_since timestamptz;
```

---

## Phase 5: Gmail Webhook (Real-Time Scanning)

**Problem:** The hourly cron means up to 59 minutes of lag. Time-sensitive emails (compliance notices, quick back-and-forth) sit unprocessed. The Pete "can't open file" scenario happened within minutes — the hourly scan missed the whole exchange.

**Fix:** Use Gmail's push notification API to trigger scans in real-time when mail arrives.

### How it works
Gmail can push a notification to a URL within seconds of a new message arriving. You register a "watch" on the inbox, Gmail sends a Pub/Sub message to Google Cloud, Pub/Sub POSTs to your Vercel endpoint, and you process just that thread immediately.

### Cost
**~$0/month.** Google Cloud Pub/Sub has a 10GB/month free tier. At your email volume (~30-50 emails/day), you'd use well under 1MB/month. Vercel function invocations go down (30 targeted calls vs. 24 full scans/day).

### What needs to be built

**1. Google Cloud Pub/Sub setup (one-time)**
- Create a GCP project (or use an existing one)
- Enable the Pub/Sub API and Gmail API
- Create a Pub/Sub topic (e.g. `crosby-gmail-push`)
- Create a push subscription that POSTs to `https://[your-domain]/api/webhooks/gmail`
- Grant Gmail permission to publish to the topic

**2. New Vercel endpoint: `src/app/api/webhooks/gmail/route.ts`**
- Receives POST from Pub/Sub
- Validates the request (Pub/Sub sends a JWT — verify it)
- Decodes the notification: contains `emailAddress` and `historyId`
- Uses the Gmail API to fetch history since the last known `historyId` (stored in `email_scans` table or a new `gmail_watch_state` table)
- Passes the changed message IDs to the existing email-scan processing logic
- Returns 200 quickly (Pub/Sub retries if you don't)

**3. Gmail watch registration**
- Call `gmail.users.watch()` to register your inbox for push notifications
- Watches expire every 7 days — add a daily cron (`0 9 * * *`) that renews the watch
- Store the watch expiry and current `historyId` in the DB

**4. New DB table: `gmail_watch_state`**
```sql
CREATE TABLE gmail_watch_state (
  id uuid primary key default gen_random_uuid(),
  gmail_account text not null unique,
  history_id text not null,
  watch_expiry timestamptz not null,
  updated_at timestamptz default now()
);
```

**5. Keep hourly cron as a safety net**
The hourly scan should stay but act as a fallback — if the webhook missed something (Pub/Sub delivery failure, Vercel cold start timeout), the hourly pass catches it. When the hourly scan runs, it compares the current `historyId` against what's stored and only processes the delta.

**Note on idempotency:** The webhook can fire multiple times for the same event (Pub/Sub retries on non-200 responses). The dedup fix from Phase 1 (checking for existing action items by `source_id` before inserting) is a prerequisite here — without it, webhook retries would create duplicate action items. Phase 1 must be shipped before Phase 5.

### Scan frequency setting (future, not v1)

Vercel cron schedules are baked into `vercel.json` at deploy time — you can't change them from a UI without a redeploy. For v1, skip the settings UI and just ship the webhook + hourly fallback. If you later want a 15-minute option, it's a one-line change to `vercel.json` plus a preference check at the top of the cron handler to skip if the webhook is active.

---

## Implementation Order

1. **Phase 1** (duplicates) — 1-2 hours, pure code change, no migration
2. **Phase 2** (due dates) — 1 hour, prompt change + schema already supports it
3. **Phase 3** (delivery failures) — 2 hours, new detection logic
4. **Phase 4** (outbound tracking) — half day, new column + nudge integration
5. **Phase 5** (Gmail webhook) — 1 day, biggest lift but highest impact

Phases 1-3 can be done in a single session. Phase 4 is a separate session. Phase 5 (Gmail webhook) is the biggest lift — budget 2 days, not 1. Google Cloud auth setup reliably takes longer than expected.
