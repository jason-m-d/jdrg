# Crosby Living Presence — Feature Plan
*Status: Revised after codebase verification*
*Last updated: 2026-03-21*

---

## Context (for Claude if this conversation gets compacted)

This plan was written during a brainstorm session with Jason about making Crosby feel more alive and present when it's just sitting open in the browser. The current chat is inert when not in use — a blank box waiting for input. The goal is to make it feel like something with a pulse.

**Two features are in scope for this plan:**

1. **The Background Status Line** — a single static line below the chat input that shows the most recent background activity (last cron that ran, what it did). No animation, no cycling. Expands on click into a Background Activity log panel. Gives operational confidence: "is Crosby actually running?"

2. **Suggested Message Prompts** — instead of a static "Message Crosby…" placeholder, the input area surfaces 2-3 contextual prompt suggestions when the input is empty. Grounded in actual context (specific stores, upcoming events, action items). Clicking one populates the input. Disappear when user starts typing, replaced by specialist chips.

**What was explicitly NOT scoped here (handled in a separate doc):**
- Ambient Interjections (philosophical one-liners on a cron into the chat thread)
- The Collapse + Timeline Rail (hash marks on the left edge of chat)

Those two features have their own plan. This document is only about the Status Line and Suggested Messages.

**Design constraint from CLAUDE.md style guide:** Dark, minimal, utilitarian. No gradients, no glassmorphism, no decorative elements. No motion unless it carries meaning.

---

## Stack Reference

- Next.js App Router, TypeScript, Tailwind CSS
- Supabase (Postgres — no realtime subscriptions currently used anywhere in the codebase)
- OpenRouter for all AI calls (never call providers directly)
- Background jobs: `BACKGROUND_LITE_MODELS` constant from `src/lib/openrouter-models.ts` — Gemini Flash Lite primary, Gemini 3 Flash fallback, provider sort: `price`
- **Suggestions model: `google/gemini-3.1-flash-preview`** — must be hardcoded string or a new `BACKGROUND_MODELS` constant; no existing constant for Flash (non-Lite)
- Activity logging: `src/lib/activity-log.ts` — `logCronJob()` writes to `crosby_events` table with `event_type: 'cron_job'`
- Cron jobs defined in `vercel.json`
- Key UI files: `src/components/chat-input.tsx` (474 lines), `src/components/chat-messages.tsx`, `src/app/(app)/chat/[id]/page.tsx`, `src/app/(app)/dashboard/page.tsx`

---

## Verified Codebase Facts (from feasibility check)

These were verified against actual code — not assumed:

- **Logging infrastructure:** `src/lib/activity-log.ts` has `logCronJob(payload: CronJobPayload)`. It writes to `crosby_events` table. `CronJobPayload` already has a `summary: string` field. **No new table needed** — read from `crosby_events WHERE event_type = 'cron_job'`.
- **All 7 cron routes exist** and already call `logCronJob()`. They all pass a `summary` string. The status line can use that existing `summary` field directly.
- **No Supabase Realtime anywhere in the codebase.** Zero instances of `.channel()` or `postgres_changes`. Realtime is an unproven pattern here — polling is safer for v1.
- **`getContextBundle()` in the prefetch route is NOT exported** — it's file-scoped. Cannot be imported by a suggestions endpoint without refactoring.
- **`supabaseAdmin` import path:** `import { supabaseAdmin } from '@/lib/supabase'`
- **Chat page layout** (`page.tsx` lines 314–449):
  - Outer: `<div className="flex h-full">`
  - Inner: `<div className="flex-1 flex flex-col min-w-0">`
  - Messages area: `<div className="flex-1 overflow-hidden relative">` — this is where the scroll button lives as `absolute bottom-3`
  - `ChatInput` is a direct child of the flex-col **below** the messages area — it is NOT inside the `relative` container
  - Nothing exists below `ChatInput` in the layout
- **`ChatInput` internal structure** (lines 303–474):
  - Outer: `<div>` → `<div className="max-w-[740px] mx-auto px-8 pb-3">`
  - Delete confirmation banner (conditional)
  - Specialist chips (conditional, `mb-2` above input box)
  - Input box border container
  - Specialist chips sit **above** the input box, in the same max-width container
- **`ChatInput` current props:** `onSubmit`, `loading`, `storageKey`, `pendingDelete`, `onConfirmDelete`, `onCancelDelete` — no suggestions prop exists yet
- **`message_type` CHECK constraint** must be altered to add `ambient` — currently only allows: `briefing|nudge|alert|watch_match|email_heads_up|bridge_status`
- **`insertProactiveMessage()` does NOT send push** — push is called separately by the cron route. Ambient cron can call `insertProactiveMessage()` without push by just not calling `sendPushToAll()` afterward.
- **`crosby_events` table** is where all activity goes. Query it with `WHERE event_type = 'cron_job' ORDER BY created_at DESC LIMIT 20`.

---

## Feature 1: The Background Status Line

### What It Is

A single, **static** line of text that sits just below the chat input (inside `ChatInput`'s own container, below the input box border). It shows the most recent background activity event — the `summary` field from the most recent `crosby_events` row where `event_type = 'cron_job'`.

Examples (these are the existing `summary` strings from cron routes):
- `scanned 47 emails · 2 flagged`
- `calendar synced`
- `morning brief generated`
- `text scan complete · nothing urgent`

**No cycling. No animation. No motion.** It shows one line. When a new cron completes, it updates. That's it.

On click, it opens a **Background Activity Log** panel. More on that below.

### Why Inside ChatInput (Not the Page)

The page layout has `ChatInput` as the last child of the flex-col, with nothing below it. The messages area (`flex-1 overflow-hidden relative`) is above it. There's no natural slot in the page layout for a status line that's "below the input." The cleanest insertion point is **inside `ChatInput`**, below the input box border container — in the same `max-w-[740px] mx-auto px-8` wrapper that holds the chips and input box. This keeps it contained within the input's visual column and avoids touching the page layout.

### Data Source

No new table. No new migration. Query `crosby_events` directly:

```sql
SELECT payload->>'summary' as summary, payload->>'job_name' as job_name, created_at
FROM crosby_events
WHERE event_type = 'cron_job'
ORDER BY created_at DESC
LIMIT 20
```

The `summary` field is already populated by all existing cron routes via `logCronJob({ ..., summary: '...' })`. No cron route changes needed unless we want richer summaries (optional improvement, not required).

### The Endpoint

**`GET /api/activity/recent`** — no body, no auth (same pattern as other internal endpoints). Returns:

```ts
{ events: { summary: string; job_name: string; created_at: string }[] }
```

### Live Updates

**No Supabase Realtime for v1** — it's not used anywhere in the codebase and introducing it just for this feature adds unproven infrastructure. Instead: poll `GET /api/activity/recent` every **60 seconds** when the tab is visible. Refresh on `visibilitychange` (tab comes back into focus). This means a status line update arrives within 60 seconds of a cron completing — acceptable for ambient status.

```ts
// In page.tsx or a custom hook
useEffect(() => {
  loadActivityEvents()
  const interval = setInterval(loadActivityEvents, 60_000)
  const onVisible = () => { if (document.visibilityState === 'visible') loadActivityEvents() }
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearInterval(interval)
    document.removeEventListener('visibilitychange', onVisible)
  }
}, [])
```

### The Expand Panel

On click, an overlay panel expands **upward** from the status line, overlaying the bottom of the message thread. It's positioned `absolute bottom-[statusLineHeight]` within the `<div className="flex-1 flex flex-col min-w-0">` container — but wait: that container doesn't have `relative` positioning. **Fix: add `relative` to the outer flex-col div** (line 315 of `page.tsx`). Then the absolute panel anchors to it.

Panel specs:
- `absolute bottom-[inputHeight] left-0 right-0 max-h-[220px] overflow-y-auto z-20`
- `bg-background border-t border-border/20 shadow-[0_-4px_20px_rgba(0,0,0,0.2)]`
- List of last 20 events, newest at top, relative timestamps
- Closes on: click outside, Escape key, click status line again

**Mobile:** Deferred. The virtual keyboard + absolute panel geometry is complex. Status line exists but no expand on mobile in v1.

### The Component

**`src/components/activity-status-line.tsx`** (new)

Props:
```ts
interface ActivityStatusLineProps {
  events: ActivityEvent[]
  expanded: boolean
  onToggle: () => void
}
interface ActivityEvent {
  summary: string
  job_name: string
  created_at: string
}
```

Collapsed render (inside the `max-w-[740px] mx-auto px-8` wrapper, below the input box):
```tsx
<div className="pt-1.5 pb-0.5">
  <button
    onClick={onToggle}
    className="group text-left w-full"
  >
    <span className="text-[0.68rem] font-mono text-muted-foreground/30 group-hover:text-muted-foreground/55 transition-colors">
      {mostRecentEvent ? `${mostRecentEvent.summary} · ${relativeTime(mostRecentEvent.created_at)}` : ''}
    </span>
  </button>
</div>
```

No icon. No dot. Extremely quiet. Hover makes it slightly more visible.

### Changes to `ChatInput`

Add `activityEvents` and `onActivityToggle` and `activityExpanded` props to `ChatInputProps`. Render `<ActivityStatusLine>` at the bottom of the `max-w-[740px]` container, after the input box. Pass state down from the page.

Alternatively — **simpler approach**: `ChatInput` handles its own activity data fetch internally. Add a `useEffect` inside `ChatInput` that calls `/api/activity/recent` on mount and polls every 60s. No prop drilling, no page changes beyond adding the panel to the layout. Self-contained.

**Decision: use the self-contained approach.** It keeps the page clean. `ChatInput` is already large but this is logically related to the input area.

### File-by-File Changes (Feature 1)

| File | Change |
|------|--------|
| `src/app/api/activity/recent/route.ts` | New endpoint: query `crosby_events`, return last 20 cron job events |
| `src/components/activity-status-line.tsx` | New component: status line text + expanded log panel |
| `src/components/chat-input.tsx` | Add internal `useEffect` to fetch/poll activity events; render `ActivityStatusLine` at bottom of wrapper; manage expanded state |
| `src/app/(app)/chat/[id]/page.tsx` | Add `relative` to the outer `flex-1 flex flex-col min-w-0` div (line 315) to anchor the expand panel |
| `src/app/(app)/dashboard/page.tsx` | Same `relative` addition |

No cron route changes needed. No DB migrations needed. No new tables.

### Out of Scope for V1
- Supabase Realtime for instant updates (polling at 60s is sufficient)
- Mobile expand panel
- Filtering by event type
- Error state entries (only `success: true` cron jobs have meaningful summaries for now)
- Cron routes writing richer `summary` strings (they already write summaries; this is an optional polish item)

---

## Feature 2: Suggested Message Prompts

### What It Is

When the chat input is **empty and not loading**, 2-3 pill chips appear above the input box (in the same location as specialist chips). Each is a specific, grounded question Jason might want to ask. Clicking one populates the input textarea without submitting. When Jason starts typing, these chips disappear and specialist chips take over (they're in the same slot — no coexistence needed).

### Visual Coexistence with Specialist Chips

Specialist chips render when `specialists.length > 0`. Suggestion chips render when `input.trim() === '' && !loading && suggestions.length > 0`. These are mutually exclusive because:
- When input is empty → no specialists detected → specialist array is empty → specialist chips hidden → suggestion chips visible
- When user types → local classifier fires → specialists populate → specialist chips show → suggestion chips hidden

They share the same rendered slot (before the input box border). The condition logic ensures only one set is ever visible.

### The Suggestions Endpoint

**`POST /api/chat/suggestions`** (new)

Context loaded (3 DB queries in parallel — no attempt to reuse prefetch module's in-process cache, since serverless instances don't share memory):

1. Last 5 messages from the conversation (`messages` table — role + first 150 chars of content)
2. Next 3 calendar events (`calendar_events` table or equivalent — title + start time)
3. Top 3 open action items by priority (`action_items` table — title, priority, due_date)

Server-side cache: `Map<conversationId, { suggestions: string[], timestamp: number }>`, TTL 5 minutes. Works within a warm instance; doesn't guarantee cross-instance cache hits, but reduces redundant calls during rapid navigation.

**Model:** `google/gemini-3.1-flash-preview` with fallback `google/gemini-3-flash-preview`. Provider sort: `price`. This is NOT Flash Lite — quality matters here. A new `BACKGROUND_MODELS` constant should be added to `src/lib/openrouter-models.ts` or the model string hardcoded in this route.

**Response format:** `response_format: { type: 'json_schema', json_schema: { name: 'suggestions', strict: true, schema: { type: 'object', properties: { suggestions: { type: 'array', items: { type: 'string' } } }, required: ['suggestions'] } } }` + `plugins: [{ id: 'response-healing' }]` in `extra_body`. Same pattern as other background job structured outputs.

**Prompt:**
```
You are generating short prompt suggestions for a personal assistant chat interface.

The user is Jason. He runs restaurant franchises (Wingstop, Pickle) and manages a team.

Current context:
- Date/time: [Pacific time]
- Recent conversation: [last 3 messages — role: first 100 chars]
- Upcoming calendar events: [next 3 events — title, time]
- Open action items: [top 3 — title, priority, due date]
- Store brands/numbers: Wingstop (326, 895, 1870, ...), Pickle

Generate exactly 3 short, specific questions Jason might want to ask RIGHT NOW.

Rules:
- MUST reference something specific: a store number, a person's name, an event title, a date, or a specific action item. No generic questions.
- BAD: "What's on your calendar today?" GOOD: "What time is the meeting with Sarah?"
- BAD: "How are your tasks?" GOOD: "Any updates on the lease for store 326?"
- Max 8 words each. No punctuation at end.
Return JSON: { "suggestions": ["...", "...", "..."] }
```

**Quality gate (server-side):**
After parsing, filter each suggestion. A suggestion passes if it matches at least one of:
- Contains a digit (store number)
- Contains a word from a known contacts list (pull from context)
- Contains a calendar event title word (pull from context)
- Contains a date/time word: today, tomorrow, monday–sunday, morning, week, month

If fewer than 2 pass the quality gate, return `{ suggestions: [] }`. Client renders nothing.

### Client-Side State in `ChatInput`

The simplest approach: **`ChatInput` owns its own suggestions state**, same as it owns specialist chips state. Add a `conversationId` prop to `ChatInput` (currently it only gets `storageKey` which is used for draft persistence). Use `conversationId` to call `/api/chat/suggestions`.

Fetch on mount. Re-fetch after submit completes (add a callback prop `onResponseComplete` or pass an `onRefreshSuggestions` trigger — but simpler: re-fetch inside ChatInput whenever `loading` transitions from `true` to `false`).

```ts
// Inside ChatInput
const prevLoadingRef = useRef(loading)
useEffect(() => {
  if (prevLoadingRef.current === true && loading === false) {
    // Response just completed — refresh suggestions
    loadSuggestions()
  }
  prevLoadingRef.current = loading
}, [loading])
```

`visibilitychange` listener inside ChatInput as well:
```ts
useEffect(() => {
  const handler = () => { if (document.visibilityState === 'visible') loadSuggestions() }
  document.addEventListener('visibilitychange', handler)
  return () => document.removeEventListener('visibilitychange', handler)
}, [conversationId])
```

No `setInterval`. The two triggers (post-response + tab focus) are sufficient.

### The Chip Component

**`src/components/suggestion-chips.tsx`** (new) — or inline in `ChatInput` since it's small.

```tsx
{input.trim() === '' && !loading && suggestions.length > 0 && (
  <div className="flex flex-wrap gap-1.5 mb-2">
    {suggestions.map((s, i) => (
      <button
        key={i}
        onClick={() => {
          setInput(s)
          textareaRef.current?.focus()
        }}
        className="text-[0.72rem] border border-border/25 bg-transparent text-muted-foreground/55 rounded-full px-3 py-0.5 hover:border-border/50 hover:text-foreground/70 transition-all"
      >
        {s}
      </button>
    ))}
  </div>
)}
```

Rendered in the same slot as specialist chips (lines 329–358 of `chat-input.tsx`), with a conditional that shows suggestions when input is empty and specialist chips otherwise. They don't coexist.

**Empty state / loading state:** Show nothing. Don't render a skeleton. The textarea placeholder handles empty state. Suggestion chips are purely additive.

### Changes to `ChatInput`

`ChatInput` needs:
1. New prop: `conversationId?: string` — used to call the suggestions endpoint
2. Internal state: `suggestions: string[]`
3. Internal `useEffect` for initial load + visibility refresh
4. Loading-transition watcher (re-fetch after `loading` goes false)
5. Suggestion chips render block (same slot as specialist chips, mutually exclusive condition)

### File-by-File Changes (Feature 2)

| File | Change |
|------|--------|
| `src/app/api/chat/suggestions/route.ts` | New endpoint: load context, call Flash, apply quality gate, return suggestions |
| `src/lib/openrouter-models.ts` | Add `BACKGROUND_MODELS` constant for `google/gemini-3.1-flash-preview` with fallback — OR just hardcode the model string in the suggestions route |
| `src/components/chat-input.tsx` | Add `conversationId` prop, internal suggestion fetch/state, chip render block (mutually exclusive with specialist chips) |
| `src/app/(app)/chat/[id]/page.tsx` | Pass `conversationId={id}` to `ChatInput` |
| `src/app/(app)/dashboard/page.tsx` | Pass `conversationId={mainConversationId}` to `ChatInput` (the main conversation ID, already loaded) |

No new component file needed — suggestion chips are small enough to inline in `ChatInput`.

### Out of Scope for V1
- User-pinned suggestions
- Suggestions analytics
- Offline / no-context fallback chips (quality gate returns nothing if context is missing)
- Suggestion categories

---

## Implementation Order (Both Features)

1. Build `/api/activity/recent` endpoint (reads `crosby_events`, no migration needed)
2. Build `ActivityStatusLine` component (static text, no panel yet)
3. Wire into `ChatInput` with internal polling — verify it shows real data
4. Add `relative` to outer flex-col in `page.tsx` and `dashboard/page.tsx`
5. Build expand panel in `ActivityStatusLine` — verify overlay positioning works
6. Build `/api/chat/suggestions` endpoint — test quality gate with real context
7. Add `conversationId` prop to `ChatInput`, add suggestion fetch + state
8. Add suggestion chip render block (mutually exclusive with specialist chips)
9. Pass `conversationId` from both pages into `ChatInput`
10. End-to-end test: load → see suggestions → click → populate input → send → suggestions refresh after response
11. Verify status line updates within 60s of a cron firing
12. Update `scripts/seed-app-manual.ts`
13. Deploy

---

## Open Risks

1. **Suggestions quality is the biggest unknown.** Flash (not Lite) + quality gate is the defense, but the prompt will need iteration post-ship. If Jason never clicks suggestions after a week, the feature isn't working.

2. **`ChatInput` is already 474 lines.** Adding suggestion fetch, activity fetch, and chip rendering adds meaningful complexity. Consider extracting into a `useSuggestions` and `useActivityStatus` hook to keep the component readable. Not required for v1 but worth keeping in mind.

3. **Dashboard `conversationId`:** The dashboard page uses the main conversation (project_id IS NULL). It already loads this conversation on mount. The `conversationId` to pass to `ChatInput` is whatever main conversation ID is in state. Needs to be verified at implementation time that this is available when `ChatInput` mounts.

4. **Expand panel absolute positioning:** Adding `relative` to the outer `flex-1 flex flex-col min-w-0` div is a layout change. Verify it doesn't affect the existing scroll button (`absolute bottom-3` inside the messages area's own `relative` container — that's fine, it's in a nested `relative`). Should be safe but needs a visual check after implementation.

5. **Quality gate false negatives:** The specificity check is a simple string match. It will occasionally suppress genuinely good suggestions. Watch for this post-ship and loosen the gate if needed.

6. **No Supabase Realtime:** Activity status line updates via 60-second polling. This means a cron that runs right after a poll won't show up for up to 60 seconds. Accepted tradeoff — it's ambient status, not a notification.
