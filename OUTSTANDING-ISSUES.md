# Crosby - Outstanding Issues & Tech Debt

This is a living document. When you discover an issue that doesn't need to be fixed RIGHT NOW, log it here instead of losing track of it. When you fix something, move it to the Resolved section with the date and what you did.

Check this file at the start of every work session. If Jason asks "what's on the list" or "what needs fixing", reference this file.

---

## Active Issues

_No active issues._

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

### [LOW] Duplicate action items from email scan re-processing
- **Found:** 2026-03-19
- **Resolved:** 2026-03-19
- **What happened:** Email scan cron had no dedup check before inserting action items. Every re-run of an email produced another copy. 13 duplicates accumulated across 9 email threads.
- **What was done:** Added `emailsWithItems` set (built from `source_id` of existing items) to skip emails already processed. Also deleted 13 duplicate DB rows, keeping oldest of each group. Bumped existingItems query limit from 30→100. (commit 3dd3ce1)
