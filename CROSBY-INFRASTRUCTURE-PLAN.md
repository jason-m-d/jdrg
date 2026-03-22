# Crosby Infrastructure Upgrade Plan

## Context

Crosby works and delivers value, but has real operational gaps: Langfuse only receives metadata forwarded by OpenRouter (no nested traces, no eval datasets, no direct cost attribution), complex crons have no step-level retries (email-scan silently fails end-to-end), and RAG retrieval quality is limited by raw cosine similarity ranking. This plan addresses the highest-impact improvements identified through evaluation of 6+ infrastructure options, narrowed to only what solves problems we're actively hitting.

## What We're NOT Doing (and why)

- **Portkey** — overlaps with Langfuse, adds a third network hop for speculative semantic caching gains
- **Exa** — no active workflow demands it yet
- **Braintrust** — Langfuse eval + crosby-eval skill covers current needs
- **Prompt management platform** — prompts in git with atomic deploys is better than a runtime dependency
- **Inngest** — deferred until Phase 4 error alerting gives us real data on how often email-scan actually fails. If silent failures are frequent, revisit. See "Inngest Deferral" section below.
- **Migrating all 11 crons** — simple crons work fine as Vercel crons
- **Perplexity Agent API** — it orchestrates third-party models (Claude, GPT, Gemini) with web search on top; that's exactly what we've already built via OpenRouter. No value add.
- **Perplexity embeddings** — pplx-embed models are stronger on benchmarks and have 4x context window vs OpenAI text-embedding-3-small, but they're only weeks old. Migration would require re-embedding the entire document corpus. Revisit in ~6 months.

## Recommended Order

Phase 0 → Phase 4 → Phase 2 → Phase 3 → revisit Inngest with real data

---

## Phase 0: Langfuse Direct SDK Integration (~1 day)

**Why:** Currently Langfuse only receives metadata forwarded by OpenRouter via `extra_body.metadata`. This gives basic call logging but no nested traces (router → specialist → tool calls → generation), no manual scoring, no eval datasets, and no Anthropic SDK visibility. The direct SDK unlocks full observability.

### 0.1 Install and configure Langfuse SDK
- `npm install langfuse`
- Add env vars to Vercel: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASEURL`
- Create `/src/lib/langfuse.ts` — singleton Langfuse client, export helper functions
- **Guard against dev pollution:** wrap client initialization with `process.env.NODE_ENV === 'production'` check so local dev traces don't pollute production Langfuse data. In dev, the client should be a no-op.

### 0.2 Wrap OpenAI SDK client with `observeOpenAI()`
File: `src/lib/openrouter.ts` (the singleton openrouterClient)

This is the single highest-leverage change — wrapping this one client automatically traces all 14+ files that use it:
- Router classifications (`src/lib/router.ts`)
- All cron jobs (email-scan, nudge, morning-briefing, overnight-build, text-scan, summarize-conversation)
- Memory extraction, session extraction, watch checks
- Background jobs, training rule extraction

Each call already passes `buildMetadata({ call_type: '...' })` — map `call_type` to Langfuse trace name automatically.

### 0.3 Add manual tracing for Anthropic SDK calls
The Anthropic SDK clients can't be wrapped with `observeOpenAI()`. Add manual Langfuse instrumentation:

Priority targets:
- **Main chat route** (`src/app/api/chat/route.ts:49`) — highest-value trace. Create a parent trace per user message, with child spans for: router decision, data loading, tool execution, LLM generation, streaming response.
- **Background job route** (`src/app/api/background-job/route.ts:29`) — traces research jobs
- **Session extraction** (`src/lib/chat/session.ts`) — 6 separate Anthropic client instances for notepad/commitment/decision/watch/SOP extraction

Pattern: Use `langfuse.trace()` at the entry point, pass trace context through to `generation()` calls. Map existing `CallMetadata` fields:
- `call_type` → trace name
- `conversation_id` → trace session ID
- `session_id` → trace metadata
- `user_id` → trace user ID

### 0.4 Enhance `buildMetadata()` to carry Langfuse trace context
File: `src/lib/openrouter-models.ts`

- Extend `CallMetadata` with optional `traceId` field
- `buildMetadata()` attaches the active Langfuse trace ID so OpenRouter-forwarded metadata and direct SDK traces can be correlated

**Key files:**
- `src/lib/langfuse.ts` (new — client singleton + helpers, with dev no-op guard)
- `src/lib/openrouter.ts` (wrap openrouterClient with `observeOpenAI()`)
- `src/lib/openrouter-models.ts` (extend `CallMetadata`, enhance `buildMetadata()`)
- `src/app/api/chat/route.ts` (add parent trace + child spans for main chat)
- `src/app/api/background-job/route.ts` (add tracing)
- `src/lib/chat/session.ts` (add tracing to extraction calls)

---

## Phase 4: Error Alerting (~0.5 day) ← Do this second

**Why:** Dashboards nobody checks are useless. Crosby already has push notification infrastructure (`sendPushToAll`) and proactive messaging — we just need to wire cron failures into it. This also answers the Inngest question: once cron failures push-notify us, we'll know within weeks whether email-scan is actually failing silently and whether Inngest is worth it.

### 4.1 Add step-level logging to email-scan
Before wiring up alerts, break email-scan's 6 logical phases into named functions and wrap each in try/catch with structured logging to `background_jobs` or `crosby_events`. This gives query-level visibility ("did step 3 fail last Tuesday?") without adding a new vendor.

### 4.2 Add cron failure alerting
Create `/src/lib/cron-alerting.ts`:
- `reportCronFailure(cronName: string, error: Error, context?: Record<string, unknown>): Promise<void>`
- Sends push notification via existing `sendPushToAll()`
- Inserts proactive message in conversation
- Logs to `crosby_events` via existing `logError()`
- Rate-limited: max 1 alert per cron per hour (prevent alert storms)

### 4.3 Wire into all cron routes
- Wrap each cron's main logic in try/catch that calls `reportCronFailure()` on error
- Start with email-scan and nudge (most complex, most likely to fail)
- Then add to remaining Vercel crons

**Key files:**
- `src/lib/cron-alerting.ts` (new)
- All `src/app/api/cron/*/route.ts` files (add try/catch wrapper)
- `src/lib/push.ts` (no changes — already has `sendPushToAll`)
- `src/lib/proactive.ts` (no changes — already has `insertProactiveMessage`)

---

## Phase 2: Cohere Rerank (~0.5 day)

**Why:** RAG retrieval uses raw cosine similarity from pgvector. Relevant passages get buried below less-relevant ones that happen to be closer in embedding space. Reranking is the highest-ROI RAG improvement — retrieve wide (top-20), rerank to top-5.

### 2.1 Add Cohere rerank
- `npm install cohere-ai`
- Add `COHERE_API_KEY` env var to Vercel
- Create `/src/lib/rerank.ts`:
  - `rerankChunks(query: string, chunks: ChunkWithMeta[], topN: number): Promise<ChunkWithMeta[]>`
  - Calls Cohere Rerank API with query + chunk contents
  - Returns reordered chunks with rerank scores
  - Hard timeout: if Cohere doesn't respond within 500ms, skip reranking and return cosine-ranked results. Log the timeout so we can track if it's consistently slow.

### 2.2 Integrate into RAG pipeline
Hook point: `src/lib/rag.ts` — inside `retrieveRelevantChunks()` and `retrieveRelevantContextChunks()`

**Current flow:**
```
Query → embed → pgvector top-8 (threshold 0.7) → buildContext()
```

**New flow:**
```
Query → embed → pgvector top-20 (threshold 0.6) → Cohere Rerank → top-5 → buildContext()
```

- Widen the retrieval window: change `match_count` from 8 to 20, lower threshold from 0.7 to 0.6
- Insert `rerankChunks()` call after pgvector retrieval, before returning results
- Same pattern for `retrieveRelevantContextChunks()` and `retrieveRelevantDecisions()`
- Graceful fallback: if Cohere API fails or times out, return original cosine-ranked results (don't break RAG)

**Key files:**
- `src/lib/rerank.ts` (new)
- `src/lib/rag.ts` (modify retrieval functions)
- `src/lib/embeddings.ts` (no changes)
- `src/lib/chat/context-loader.ts` (no changes — consumes rag.ts output)

---

## Phase 3: Perplexity Deep Research + Citation UI (~2 days)

**Why:** Two separate improvements bundled here:
1. `sonar-deep-research` for explicit deep research requests — 20-50+ searches, comprehensive synthesis. Reserve for when the user actually asks for research, not as a default search upgrade.
2. Citation surfacing — Perplexity already returns a `citations` array on every search call. We're currently discarding it. Surfacing those as clickable sources is the highest-ROI change in this phase.

### 3.1 Add `sonar-deep-research` as a second search model
File: `src/lib/openrouter-models.ts`

```ts
export const SEARCH_MODELS = {
  quick: 'perplexity/sonar-pro-search',       // existing — fast factual lookups
  deep: 'perplexity/sonar-deep-research',     // new — multi-hop research reports
  provider: { sort: 'price' as const },
}
```

No new API key. No new client. Same OpenRouter routing pattern.

### 3.2 Add `deep_research` tool
File: `src/lib/specialists/built-in/core.ts` and `src/app/api/chat/route.ts`

- New tool: `deep_research(query: string)` — delegates to `sonar-deep-research` via OpenRouter
- Tool description must make clear: use ONLY when the user explicitly asks to "research", "investigate", "find everything about", or similar. NOT for factual lookups or casual web questions.
- Include cost note in tool description: "expensive call (~$0.20-0.50), use only for explicit research requests"
- Crosby decides which tool to use: `search_web` for quick lookups, `deep_research` for explicit research requests

### 3.3 Surface citations as structured data
File: `src/lib/chat/web-search.ts`

Update `executeWebSearch()` to:
- Return `{ result: string, citations: Citation[] }` where `Citation = { url: string, title: string, snippet: string, domain: string }`
- Extract the `citations` array from the Perplexity response
- Apply to both `search_web` and `deep_research`

### 3.4 Store citations on the message
Citations need to be stored as structured data, not embedded in response text.

- Add `citations` JSONB column to the `messages` table (migration)
- When a search tool is used, attach the returned citations to the assistant message on insert
- Citations shape: `{ url, title, snippet, domain }[]`

### 3.5 Stream citations through SSE
File: `src/app/api/chat/route.ts`

After tool execution, emit a dedicated SSE event type (e.g., `citations`) carrying the structured citation array. The client stores this alongside the in-progress message so the UI can render chips and the sources panel.

### 3.6 Citation UI — inline chips + sources panel
This is a full UI build. Components needed:

**Inline chips:**
- Rendered inside the message bubble alongside the markdown text
- Each chip shows the domain name (e.g., `github`, `reddit`) with favicon
- If more than 3 sources, show the first 2 + "+N" overflow chip
- Chips appear at the end of the relevant sentence/paragraph if positional data is available, otherwise at the end of the message

**"X sources" button in action row:**
- Sits in the existing message action row (alongside share, copy, etc.)
- Shows favicon icons for the top 3-4 sources + "X sources" count
- Clicking opens the sources slide-in panel

**Sources slide-in panel:**
- Reuses the existing slide-in panel pattern in the app
- Header: "Sources for [query]"
- Each source: favicon, domain label, title (linked), snippet text
- Scrollable list

**Key files:**
- `src/lib/chat/web-search.ts` (return structured citations)
- `src/lib/chat/tools/executors.ts` (pass citations back through tool result)
- `src/app/api/chat/route.ts` (emit citations SSE event, store on message)
- `scripts/` (migration for `citations` column on `messages`)
- `src/components/chat/MessageBubble.tsx` or equivalent (inline chips)
- `src/components/chat/MessageActions.tsx` or equivalent (sources button)
- `src/components/chat/SourcesPanel.tsx` (new — slide-in sources panel)

**Estimated effort:** ~1.5 days for the UI alone. The backend changes (3.1–3.5) are ~0.5 day.

---

## Inngest Deferral

**Decision:** Don't add Inngest now. The core value proposition is step-level retries for email-scan and event-driven nudge triggers. But we don't have data on how often email-scan actually fails silently.

**Plan:** After Phase 4 (error alerting) is live, run for 2-4 weeks. If we're seeing regular cron failures push-notified to us, revisit Inngest. If failures are rare, the step-level logging added in Phase 4.1 is sufficient visibility.

**What Inngest would add if we revisit:**
- Independent retry per step (Gmail 429 at step 1 doesn't kill steps 2-6)
- Event-driven nudge: fires immediately when email-scan finds something actionable, not on a 3-hour schedule
- Built-in failure dashboard

**Migration path if we do it:** email-scan and nudge only. Simple crons stay on Vercel.

---

## Verification

### Langfuse SDK
- Verify traces appear in Langfuse dashboard for all 15 CallTypes
- Confirm nested spans on a main chat message: router → data loading → generation
- Verify cost attribution per call type in Langfuse cost dashboard
- Confirm OpenAI SDK calls (via `observeOpenAI()`) auto-trace without manual instrumentation
- Verify Anthropic SDK manual traces (chat route, background jobs) show correct metadata
- Confirm local dev does NOT send traces to Langfuse (no-op guard working)

### Error Alerting
- Trigger a cron failure (e.g., invalid API key), verify push notification received
- Verify proactive message appears in conversation
- Verify rate limiting: trigger same cron failure twice within an hour, confirm only 1 alert
- Verify step-level logs for email-scan appear in `background_jobs`/`crosby_events`

### Cohere Rerank
- Compare RAG results before/after on 5-10 representative queries
- Verify fallback: temporarily use invalid API key, confirm RAG still works with cosine-only ranking
- Verify timeout fallback: if Cohere > 500ms, reranking is skipped and cosine results returned
- Check latency impact: rerank call should add < 200ms in the happy path

### Perplexity Deep Research + Citations
- Test `deep_research` tool with an explicit research request ("research everything about X")
- Verify `search_web` is still used for casual lookups — model should NOT call `deep_research` for simple questions
- Compare `deep_research` output quality vs `search_web` for the same complex query
- Verify citations are stored in the `messages` table as JSONB
- Verify citations SSE event arrives on the client before message completes
- Verify inline chips render correctly: domain names, favicons, "+N" overflow
- Verify "X sources" button appears in action row with correct count
- Verify sources panel opens and shows title/snippet/favicon per source
- Verify `search_web` also now returns and displays citations

---

## Estimated Total Effort

| Phase | Effort |
|---|---|
| Phase 0 — Langfuse direct SDK | ~1 day |
| Phase 4 — Error Alerting + step logging | ~0.5 day |
| Phase 2 — Cohere Rerank | ~0.5 day |
| Phase 3 — Perplexity deep research + citation UI | ~2 days |
| **Total** | **~4 days** |

## Monthly Cost Impact

| Service | Estimated Cost |
|---|---|
| Langfuse Cloud (Free → Pro) | $0-59/mo |
| Cohere Rerank (pay-as-you-go) | ~$5-10/mo |
| Perplexity `sonar-deep-research` (pay-as-you-go, ~$0.20-0.50/call) | ~$5-15/mo |
| **Total new** | **~$10-84/mo** |

*Inngest ($20/mo) removed from cost estimate — deferred pending real failure data.*
