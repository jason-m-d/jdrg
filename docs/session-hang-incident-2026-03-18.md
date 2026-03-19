# Chat Route Hang — Incident Report (2026-03-18)

## What Broke

Production chat stopped working completely after shipping the intent classifier
(selective context injection). Every message timed out with a 504 or showed
"something went wrong." Local worked fine.

## Root Cause (Found)

**Supabase `sessions` table queries hang indefinitely in production.**

`getOrCreateSession()` is called at the start of every chat request. It makes
2-4 sequential Supabase queries against the `sessions` table. In production,
query 1 (find open session) never completes — it just hangs forever until
Vercel kills the function at the 60s `maxDuration` limit.

The same queries run instantly in local and directly via psql. This points to a
connection-level issue in the Vercel serverless environment, not a bad query.

### Why It Looked Like the Intent Classifier Was the Problem

The intent classifier shipped the same day. But it's called *after*
`getOrCreateSession` and is pure synchronous code — no DB calls. It was a red
herring. The sessions hang was already lurking; the classifier deployment just
coincided with the break becoming visible.

### What Made It Hard to Diagnose

1. **Vercel logs truncate to one line per request.** The MCP tool only surfaces
   the first log line from each serverless invocation. All the checkpoint logs
   added during debugging (`[Session] query 1 done`, `[Chat] Promise.all done`,
   etc.) were invisible — only the first `[Chat] getOrCreateSession start` ever
   showed up.

2. **The function returned 504, masking the real error.** Later, after moving
   setup inside the stream (so the HTTP connection opened immediately), the real
   error surfaced: a `400` from OpenRouter caused by 31 consecutive user messages
   with no assistant reply — a second bug caused by all the prior timeouts
   stacking up in the DB.

3. **Two bugs compounded each other.** Even after the sessions hang was worked
   around, the poisoned conversation history (31 unanswered "hey" messages) was
   causing a 400. Both had to be fixed.

## Fixes Shipped

### 1. Stream starts immediately (architectural improvement)
Moved all pre-OpenRouter setup inside `ReadableStream.start()` so the HTTP
response begins instantly. Previously the route did 4+ seconds of blocking work
before returning any response, which made timeouts look like hard failures.

**Commit:** `8db2916` — `debug: move all chat setup inside stream, emit ping immediately on connect`

### 2. Deduplicate consecutive same-role messages
Before sending history to OpenRouter, collapse consecutive messages from the
same role. The 31 stacked "hey" messages caused a 400 (Anthropic rejects
consecutive user turns with no assistant reply between them).

**Commit:** `b39ff36` — `fix: collapse consecutive same-role messages before sending to OpenRouter`

### 3. 5-second timeout on `getOrCreateSession` (workaround)
Wrapped all session DB queries in a `Promise.race` with a 5s timeout. If
Supabase doesn't respond in time, `sessionId` is `null` and chat continues
without session tracking. Messages are saved without `session_id`, history
loads from the full conversation instead.

**Commits:** `f4be183`, `d284362`

## What Is Still Broken / Left to Investigate

### Sessions table queries intermittently slow in production

Investigation on 2026-03-18 confirmed:
- No stuck transactions or locks on `pg_stat_activity` / `pg_locks`
- No RLS interference (`supabaseAdmin` bypasses RLS, `relforcerowsecurity` is false)
- `increment_session_message_count` RPC exists and is correct
- Table has proper indexes and only 6 rows
- The hang was transient — likely Supabase REST API latency during serverless cold starts

Sessions are creating/closing correctly now. The timeout is a safety net, not
the primary path.

## Follow-up Fixes Shipped (2026-03-18)

### 1. Session tracking restored
Reverted parallel session lookup (fire-and-forget update silently failed).
Session queries take ~200ms — fast enough to run sequentially before the
user message save. Both user and assistant messages now get `session_id`,
and `message_count` increments correctly via the RPC.

### 2. Timeout kept as safety net (10s)
Since the stream is already open (fix #1 from the original incident), a 10s
timeout has no UX impact. Session queries complete in ~200ms normally.

### 3. Message dedup hardened
Added guard to ensure messages end with user role before sending to OpenRouter.
Prevents 400 errors from poisoned conversation history.

### 4. Debug logs cleaned up
All `[Chat]` debug checkpoint logs removed. `[Session]` timing logs and
`[Intent]` classifier log remain for monitoring.

### 5. Session summary cron (`/api/cron/session-summary`)
Runs every 15 minutes. Finds closed sessions with no summary, generates
bullet-point summaries via Gemini Flash Lite, then runs extraction pipeline:
notepad entries, commitments, decisions, watches, and SOP detection. All
backlogged sessions have been summarized.

## Key Files

- `src/app/api/chat/route.ts` — chat route, `getOrCreateSession()` around line 2478
- `src/lib/supabase.ts` — Supabase client init
- `scripts/` — migration SQL files
