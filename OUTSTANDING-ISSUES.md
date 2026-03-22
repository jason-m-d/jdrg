# Crosby - Outstanding Issues & Tech Debt

This is a living document. When you discover an issue that doesn't need to be fixed RIGHT NOW, log it here instead of losing track of it. When you fix something, move it to the Resolved section with the date and what you did.

Check this file at the start of every work session. If Jason asks "what's on the list" or "what needs fixing", reference this file.

---

## Feature Backlog

Planned features that are ready to build but parked for later.

### Living Presence — Activity Strip + Suggested Messages
- **Parked:** 2026-03-21
- **Plan doc:** `CROSBY-LIVING-PRESENCE-PLAN.md`
- **What it is:** Two features to make Crosby feel alive when idle. (1) A static background status line below the input showing the last cron that ran (reads from existing `crosby_events` table — no migration needed). (2) Contextual suggestion chips above the input when it's empty, grounded in real context (calendar, action items, stores). Both features were fully planned, critiqued, and verified against the codebase.
- **Status:** Ready to implement. Read the plan doc before starting.

---

## Active Issues

### [LOW] Background job AI produces planning language instead of direct content
- **Found:** 2026-03-22
- **Severity:** Low — jobs complete, but result text sometimes starts with "I'll run a deep research pass..." instead of actual content
- **Root cause:** Background job system prompt didn't explicitly forbid narrating intent. The model treated the job like a chat turn.
- **Fix applied:** Added explicit "CRITICAL: Write the research content directly. Do NOT say 'I'll run...'" instruction to `src/app/api/background-job/route.ts` executeJob() system prompt.
- **Status:** Fixed — monitor next few research jobs to confirm.

### [MEDIUM] embed-messages cron times out at 60s under load
- **Found:** 2026-03-22
- **Severity:** Medium — when 50 messages need embedding and each has multiple chunks, sequential `generateEmbedding()` calls can exceed the 60s Vercel function limit. One instance confirmed in runtime logs at 06:00 UTC.
- **Root cause:** `src/app/api/cron/embed-messages/route.ts` has `maxDuration = 60` but processes messages sequentially. With 50 long messages (3+ chunks each) and ~500ms per embedding call, this hits 60s easily.
- **Suggested fix options:** (1) Raise `maxDuration` to 120 or 300 (Vercel Pro supports 300s). (2) Reduce `BATCH_SIZE` from 50 to 20. (3) Batch embedding requests in parallel instead of sequential.
- **Risk:** Embeddings that timeout aren't marked `embedded_at`, so they retry on the next run. Not catastrophic — just slower to catch up.

### [LOW] run-background-jobs cron 504 when heavy research job is in-flight
- **Found:** 2026-03-22
- **Severity:** Low — one occurrence. The cron dispatches background-job fetches with Promise.all but the 504 suggests the cron function itself hit a wall-clock limit.
- **Root cause:** The `run-background-jobs` cron fires dispatch fetches but doesn't fully fire-and-forget (Promise.all awaits the fetch calls starting, not necessarily completing). Under load with long-running jobs, the function may be keeping open connections.
- **Note:** Background jobs themselves have `maxDuration = 300` — only the dispatcher cron is at risk. Low-priority since jobs still complete; the dispatcher just returns 504 occasionally.
- **Risk:** Very low — jobs still run and complete correctly.

### [LOW] Deep research job may return "No results found" without alerting
- **Found:** 2026-03-22
- **Severity:** Low — one occurrence. Perplexity returned a non-text response block; the fallback string "No results found." was stored as the result and a completion message was sent pointing to an empty artifact.
- **Suggested fix:** In `src/lib/chat/web-search.ts`, treat the fallback "No results found." string as an error (throw or log to crosby_events) so it surfaces in monitoring.
- **Risk:** Low

---

## Resolved

### [MEDIUM] Prefetch router always timing out — chips never showed for most queries
- **Found:** 2026-03-20
- **Resolved:** 2026-03-20
- **What happened:** The prefetch endpoint had a 2-second hard timeout but the AI router regularly takes 2–3 seconds. Almost every prefetch call silently returned empty results. Chips only showed for messages where the router happened to respond in < 2s (Calendar, Web Search). Sales, Email, Tasks, Contacts, and multi-domain queries all returned no chips.
- **What was done:** Bumped prefetch timeout from 2s → 5s in `src/app/api/chat/prefetch/route.ts`. Bumped router internal timeout from 3s → 4s in `src/lib/router.ts`. Full QA pass confirmed 10/10 test cases passing.

### [LOW] Prefetch cache result never reused by chat POST
- **Found:** 2026-03-20
- **Resolved:** 2026-03-20
- **What happened:** The prefetch endpoint cached router results server-side, and the frontend passed a `prefetchCacheKey` on submit — but the chat route ignored it and always re-ran the router. Zero latency benefit from the prefetch.
- **What was done:** Exported `getPrefetchedRouterResult()` from the prefetch route. Chat route now accepts `prefetch_message` in the request body and skips the router call on a cache hit. Both page handlers (`chat/[id]/page.tsx`, `dashboard/page.tsx`) now forward the message for cache lookup.

### [LOW] Memory extraction had no debounce — could create duplicate memories on rapid messages
- **Found:** 2026-03-20
- **Resolved:** 2026-03-20
- **What was done:** Added an in-process module-level `lastExtractionAt` timestamp to `src/lib/chat/memory-extraction.ts`. Extraction is skipped if it ran within the last 5 seconds.

_Move items here when fixed. Include date and what was done._

### [MEDIUM] Duplicate ANTHROPIC_API_KEY on Vercel
- **Found:** 2026-03-19
- **Resolved:** 2026-03-20
- **What was done:** Removed the bad `sk-ant-api03-...` key from preview/dev environments, replaced with the correct OpenRouter key (`sk-or-v1-...`) on all environments. Deployed to production.

### [LOW] CRON_SECRET mismatch between local and Vercel
- **Found:** 2026-03-19
- **Resolved:** 2026-03-20
- **What was done:** Removed old `jdrg-cron-2026` value and replaced with `crosby-cron-2026` across all environments (production, preview, development).

### [LOW] Missing BRIDGE_API_KEY on Vercel
- **Found:** 2026-03-19
- **Resolved:** 2026-03-20
- **What was done:** Added `BRIDGE_API_KEY` to all three Vercel environments (production, preview, development).

### [MEDIUM] Retry logic bug - streamAttempt never increments
- **Found:** 2026-03-19
- **Resolved:** 2026-03-19
- **What was done:** Changed `streamAttempt = 1` to `streamAttempt = 2` in three catch blocks in `src/app/api/chat/route.ts`. Deployed in commit 5e5f82c area.

### [CRITICAL] Duplicate request_additional_context tool caused 400 errors on every message
- **Found:** 2026-03-19
- **Resolved:** 2026-03-19
- **What happened:** `request_additional_context` was listed in `src/lib/specialists/built-in/core.ts` tools array AND appended separately in the chat route, sending the tool twice. Claude rejected every request with 400 "tool names must be unique." Users saw "I ran into a connection issue" on every message.
- **What was done:** Removed `request_additional_context` from `core.ts` tools array (commit 5e5f82c). Added self-healing note to CLAUDE.md.

### [MEDIUM] Error responses saved as conversation history
- **Found:** 2026-03-19
- **Resolved:** 2026-03-19
- **What happened:** When a connection error occurred, the "I ran into a connection issue" text was inserted into the `messages` table. On recovery, those messages loaded as history and caused the model to generate architecture rants instead of answering questions.
- **What was done:** Added `isErrorResponse` flag in `src/app/api/chat/route.ts`; DB insert is skipped when the flag is set. Also manually deleted ~46 polluted messages from the main conversation. (commit 6b13d6d)

### [MEDIUM] Sessions never auto-closed when user stops chatting
- **Found:** 2026-03-19
- **Resolved:** 2026-03-19
- **What happened:** Sessions only closed when a new message came in and triggered `getOrCreateSession()`. If the user stopped chatting, the session stayed open indefinitely. The session-summary cron only summarized already-closed sessions — nothing proactively closed idle ones.
- **What was done:** Added idle session detection to `src/app/api/cron/session-summary/route.ts` — it now closes any open session with no activity in the last 2 hours before running summaries. (commit 6b13d6d)

### [LOW] Stale queued background jobs from Mar 19-21
- **Found:** 2026-03-22
- **Resolved:** 2026-03-22
- **What happened:** 7 background jobs from Mar 19-21 were stuck in `queued` status. The run-background-jobs cron has a 2-hour pickup window by design, so jobs older than 2 hours never get dispatched.
- **What was done:** Ran SQL to mark all expired queued jobs as `failed` with error "Expired: exceeded 2-hour pickup window at time of execution". Queue is clean.

### [LOW] Dead imports: wasTopicSurfacedRecently and AttendeeContext
- **Found:** 2026-03-22
- **Resolved:** 2026-03-22
- **What was done:** Removed unused `wasTopicSurfacedRecently` import from `email-scan/route.ts` and `nudge/route.ts`. Removed unused `AttendeeContext` interface from `system-prompt.ts`. Build/tsc still clean.

### [LOW] Duplicate action items from email scan re-processing
- **Found:** 2026-03-19
- **Resolved:** 2026-03-19
- **What happened:** Email scan cron had no dedup check before inserting action items. Every re-run of an email produced another copy. 13 duplicates accumulated across 9 email threads.
- **What was done:** Added `emailsWithItems` set (built from `source_id` of existing items) to skip emails already processed. Also deleted 13 duplicate DB rows, keeping oldest of each group. Bumped existingItems query limit from 30→100. (commit 3dd3ce1)
