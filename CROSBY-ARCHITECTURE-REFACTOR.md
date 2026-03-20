# Crosby Architecture Refactor — Status

Phases 0–4 are complete (~95%). This document has been updated to reflect what's actually built.

---

## Phase 0: Stability Guards ✅ COMPLETE

All 6 guards are live in `src/app/api/chat/route.ts`:

1. **30-second AbortController timeout** — Wraps each iteration of the streaming loop
2. **Tool call cap (max 8)** — Breaks loop and wraps up if model exceeds 8 tool calls per message
3. **Stream retry with simplified context** — On stream failure, retries once with last 5 messages and no doc chunks
4. **History deduplication** — Removes consecutive same-role messages and trims invalid flanking messages
5. **Drop short trailing assistant messages** — Removes last assistant message if < 20 chars (partial/failed response)
6. **Document context hard cap** — Truncates to 4000 chars in `src/lib/chat/context-loader.ts`

**Not implemented:** Memory extraction debounce (skip if extraction ran in last 5 seconds). Currently runs fire-and-forget on every message.

---

## Phase 1: AI Router ✅ COMPLETE

**File:** `src/lib/router.ts`

- Model: `google/gemini-3.1-flash-lite-preview`, fallback `google/gemini-3-flash-preview`, sort by price
- Returns `RouterResult` with: `intent`, `data_needed`, `tools_needed`, `rag_query`, `complexity`, `relevant_projects`
- 3-second `Promise.race()` timeout; falls back to `buildFallbackResult()` which calls the old `classifyIntent()` regex
- Wired into `src/app/api/chat/route.ts` — router result drives which data loads and which tools are active
- `Promise.all` data loading block is conditional on `data_needed`
- RAG uses `routerResult.rag_query` (rewritten for semantic search)
- `request_additional_context` tool always included; handler at lines 555–584 of chat route

---

## Phase 2: Typing Prediction + Specialist Chips ✅ COMPLETE

**Backend:** `src/app/api/chat/prefetch/route.ts`
- Returns `specialists`, `data_needed`, `tools_needed`, `rag_query`, `cache_key`, `autocomplete`
- Server-side in-memory cache (10s TTL) + 5-minute context bundle cache (contacts, projects, store numbers)
- 2-second hard timeout

**Frontend:** `src/components/chat-input.tsx`
- Local regex classifier (`classifyLocal()`) fires synchronously on keystroke for instant chips
- AI prefetch debounced at 250ms to refine chips
- Chips render above textarea as small pills with icon + label + dismiss X
- Inline ghost text autocomplete; Tab or right arrow to accept, Escape to dismiss

**Gap:** The `prefetchCacheKey` is passed from chat-input to the parent on submit, but the main chat POST route doesn't check the prefetch cache to skip the router call. Minor optimization not yet wired.

---

## Phase 3: Route Decomposition ✅ MOSTLY COMPLETE

`src/lib/chat/` exists with:
- `tools/definitions.ts` — All tool schemas + `ALL_TOOLS_MAP`
- `tools/registry.ts` — Executor registry Map (groundwork for dynamic registration)
- `tools/executors.ts` — All tool executor functions
- `tools/status-labels.ts` — UI status label mapping
- `context-loader.ts` — Conditional data loading based on `data_needed`
- `memory-extraction.ts` — Memory extraction logic
- `session.ts` — Session management
- `web-search.ts` — Web search executor

**Not split out:** `streaming.ts` and `history.ts` — streaming helpers and history loading are still inline in `route.ts`.

**Chat route is 719 lines** — down significantly from pre-refactor but still has the streaming loop and tool dispatch inline.

**Tech debt:** Tool dispatch in `route.ts` (lines 372–554) is still an explicit if/else chain instead of using the `registry` Map. The registry exists but isn't used for dispatch yet.

---

## Phase 4: Specialist System ✅ COMPLETE

**Files:**
- `src/lib/specialists/types.ts` — `SpecialistDefinition`, `SpecialistTriggerRules`, `SpecialistContext`
- `src/lib/specialists/registry.ts` — `registerSpecialist`, `resolveSpecialists`, `loadUserSpecialists` (stub for future DB-backed specialists)
- `src/lib/specialists/prompt-builder.ts` — `buildSpecialistPrompt()` assembles prompt from only active specialist sections
- `src/lib/specialists/built-in/` — 7 built-in specialists: `email`, `calendar`, `sales`, `tasks`, `documents`, `texts`, `core`

**Wired into chat route:**
- `resolveSpecialists(routerResult)` called after router
- Tools gathered from union of all active specialists
- `buildSpecialistPrompt()` replaces the old monolithic `buildSystemPrompt()`
- Active specialist IDs saved to `context_domains` in message metadata

**Trigger rules are declarative JSON** (not functions) — groundwork for user-created specialists stored in DB. `loadUserSpecialists()` stub exists and returns empty array today.

---

## Phase 5: QA ⬜ NOT DONE

The formal QA pass (Phase 5 test scenarios) has not been run as a structured session. The system is in production and working, but no systematic pass through all 15 test cases has been done.

---

## Remaining Work / Open Items

| Item | Priority | Notes |
|------|----------|-------|
| Memory extraction debounce | Low | No 5s debounce; runs on every message. Rare issue in practice. |
| Prefetch cache reuse in POST | Low | Cache key passed from UI but not checked server-side. Minor latency win. |
| `streaming.ts` + `history.ts` extraction | Low | Still inline in route.ts. Non-blocking. |
| Tool dispatch via registry | Low | if/else chain should use registry Map. Groundwork exists. |
| Phase 5 QA pass | Medium | Structured test run for router accuracy, chip behavior, self-correction tool, autocomplete |

---

## Architecture Notes (Reference)

- **Router** (`src/lib/router.ts`): Fast Gemini call that replaces regex `classifyIntent()`. Determines data to load, tools to activate, and relevant projects.
- **Specialists** (`src/lib/specialists/`): Self-contained modules with declarative trigger rules. The router activates only what's needed.
- **Prefetch** (`src/app/api/chat/prefetch/`): Called while user types. Results shown as chips. Cache can be reused on submit to skip router call.
- **Tool executor registry** (`src/lib/chat/tools/registry.ts`): Map for future dynamic tool registration. Built-in tools still use if/else dispatch for now.
- **`request_additional_context` tool**: Self-correction mechanism if router misclassifies. Model can call it mid-response to fetch missing data blocks.

## Future: User-Created Specialists

Groundwork is laid. When ready to build:
- `SpecialistDefinition` uses JSON-serializable `triggerRules` (no functions)
- `loadUserSpecialists()` stub in registry is ready to query a `specialists` DB table
- `systemPromptSection` supports `{{placeholder}}` tokens for dynamic data injection
- DB schema is designed in the original plan (see git history if needed)
