# Handoff: Claude Code Web → CLI

**Date:** 2026-03-20
**Branch:** `claude/review-recent-changes-417LU`
**Base:** `main`

---

## What Was Done on This Branch

### Code Change: Hybrid Action Items Loading (1 commit)

**Commit:** `e617e54` — `feat: hybrid action items loading — critical always, full list router-gated`

Previously, the `tasks` specialist was `always_on`, loading all 30 pending action items into the system prompt on every single message — even "good morning." This wastes tokens and context when the user isn't talking about tasks.

**The fix splits it into two specialists:**

1. **`tasks_critical`** (always on) — Loads only high-priority, overdue, or due-within-24h items (max 10) plus a total count. Lightweight. Ensures Crosby never misses something urgent.
2. **`tasks`** (router-gated) — Loads the full 30-item list, but only when the router detects the message is about tasks. When both are active, the critical section renders empty to avoid duplication.

**Files changed:**
- `src/lib/chat/context-loader.ts` — Added `action_items_critical` data block (two parallel queries: critical items + total count)
- `src/lib/router.ts` — Added `action_items_critical` to schema enum; changed base fallback from `action_items` → `action_items_critical`
- `src/lib/specialists/built-in/tasks.ts` — Split into `tasksSpecialist` (router-gated) + `tasksCriticalSpecialist` (always on)
- `src/lib/specialists/prompt-builder.ts` — Added `{{action_items_critical_section}}` template with dedup logic
- `src/lib/specialists/registry.ts` — Registered the new `tasksCriticalSpecialist`

---

## Outstanding Vercel Env Var Fixes (3 items)

These are documented in `OUTSTANDING-ISSUES.md`. All require Vercel CLI commands run from the local machine (which has `.env.local` with the correct values).

### 1. [MEDIUM] Duplicate ANTHROPIC_API_KEY on Vercel

**Problem:** Two `ANTHROPIC_API_KEY` entries on Vercel — production has the correct OpenRouter key (`sk-or-v1-...`), but "All Pre-Production Environments" has an actual Anthropic key (`sk-ant-api03-...`). Preview deploys bypass OpenRouter entirely.

**Fix:**
```bash
# Remove the bad pre-production entries
npx vercel env rm ANTHROPIC_API_KEY preview
npx vercel env rm ANTHROPIC_API_KEY development

# Get the correct value from .env.local and add it
# (use the sk-or-v1-... key from .env.local)
echo -n "YOUR_OPENROUTER_KEY" | npx vercel env add ANTHROPIC_API_KEY preview
echo -n "YOUR_OPENROUTER_KEY" | npx vercel env add ANTHROPIC_API_KEY development
```

### 2. [LOW] CRON_SECRET mismatch

**Problem:** `.env.local` has `crosby-cron-2026` but Vercel has `jdrg-cron-2026`. Production crons work fine (they use the Vercel value), but local cron testing would fail.

**Fix (pick one):**
- **Option A:** Update `.env.local` to `CRON_SECRET=jdrg-cron-2026` (match Vercel)
- **Option B:** Update Vercel to match local:
  ```bash
  npx vercel env rm CRON_SECRET production
  npx vercel env rm CRON_SECRET preview
  npx vercel env rm CRON_SECRET development
  echo -n "crosby-cron-2026" | npx vercel env add CRON_SECRET production
  echo -n "crosby-cron-2026" | npx vercel env add CRON_SECRET preview
  echo -n "crosby-cron-2026" | npx vercel env add CRON_SECRET development
  ```

### 3. [LOW] Missing BRIDGE_API_KEY on Vercel

**Problem:** `BRIDGE_API_KEY` exists in `.env.local` but not on Vercel. It IS used in production — 4 API routes (`/api/texts/heartbeat`, `/api/texts/latest-row-id`, `/api/texts/ingest`, `/api/texts/whitelisted-groups`) check it for iMessage bridge auth.

**Fix:**
```bash
# Use the value from .env.local
echo -n "YOUR_BRIDGE_API_KEY" | npx vercel env add BRIDGE_API_KEY production
echo -n "YOUR_BRIDGE_API_KEY" | npx vercel env add BRIDGE_API_KEY preview
echo -n "YOUR_BRIDGE_API_KEY" | npx vercel env add BRIDGE_API_KEY development
```

### After all env fixes, redeploy:
```bash
npx vercel --prod
```

---

## Merge Instructions

```bash
# Fetch the branch
git fetch origin claude/review-recent-changes-417LU

# Review the diff
git diff main..origin/claude/review-recent-changes-417LU

# Merge into main
git checkout main
git merge origin/claude/review-recent-changes-417LU

# Push
git push origin main
```

Or squash-merge if you prefer a clean history:
```bash
git checkout main
git merge --squash origin/claude/review-recent-changes-417LU
git commit -m "feat: hybrid action items loading — critical always, full list router-gated"
git push origin main
```

---

## After Merge

1. Run the env var fix commands above
2. Deploy: `npx vercel --prod`
3. Update `OUTSTANDING-ISSUES.md` — move the 3 env var items to Resolved
4. Delete this file (`HANDOFF-TO-CLI.md`) — it's a one-time handoff doc
