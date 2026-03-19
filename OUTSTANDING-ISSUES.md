# Crosby - Outstanding Issues & Tech Debt

This is a living document. When you discover an issue that doesn't need to be fixed RIGHT NOW, log it here instead of losing track of it. When you fix something, move it to the Resolved section with the date and what you did.

Check this file at the start of every work session. If Jason asks "what's on the list" or "what needs fixing", reference this file.

---

## Active Issues

### [MEDIUM] Duplicate ANTHROPIC_API_KEY on Vercel
- **Found:** 2026-03-19
- **What:** Two `ANTHROPIC_API_KEY` entries exist in Vercel env vars. Production has the correct OpenRouter key (`sk-or-v1-...`). "All Pre-Production Environments" has an actual Anthropic key (`sk-ant-api03-...`). Preview deploys will try to talk directly to Anthropic instead of OpenRouter.
- **Fix:** Remove the `sk-ant-api03-...` entry from Vercel, or update it to the OpenRouter key so preview deploys work too.
- **Risk:** Preview/dev deploys on Vercel are broken. Production is fine.

### [LOW] CRON_SECRET mismatch between local and Vercel
- **Found:** 2026-03-19
- **What:** `.env.local` has `crosby-cron-2026` but Vercel has `jdrg-cron-2026`. If cron routes check this secret for auth, one environment will reject cron requests.
- **Fix:** Decide which value is correct and sync both environments.
- **Risk:** Cron jobs might fail auth in one environment.

### [LOW] Missing BRIDGE_API_KEY on Vercel
- **Found:** 2026-03-19
- **What:** `BRIDGE_API_KEY` exists in `.env.local` but is not set in Vercel env vars. If any production code references it, those calls will fail.
- **Fix:** Check if any production code uses `process.env.BRIDGE_API_KEY`. If so, add it to Vercel.
- **Risk:** Unknown until we check if it's used in production routes.

---

## Resolved

_Move items here when fixed. Include date and what was done._

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
