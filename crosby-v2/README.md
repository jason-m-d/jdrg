# Crosby v2 — Research & Planning Hub

This folder contains all research, thinking, and planning for a ground-up rebuild of Crosby. Nothing here is code. It's a living workspace that Claude Code maintains and organizes.

---

## How This Folder Works

Claude Code is responsible for keeping this folder organized. Here's the system:

### Folder Structure

```
crosby-v2/
├── README.md              ← this file, always current
├── OVERVIEW.md            ← high-level vision, core principles, what we're building and why
├── research/              ← external research reports, competitive analysis, reference material
│   └── [topic].md
├── product/               ← product discovery: features, flows, UX decisions
│   └── FEATURES.md        ← master feature inventory (living doc)
├── decisions/             ← key architectural and product decisions, with rationale
│   └── [topic].md
├── architecture/          ← technical design: data model, system design, AI pipeline, etc.
│   └── [topic].md
└── features/              ← individual feature specs and thinking
    └── [feature-name].md
```

### How Claude Maintains This

- When Jason shares research, adds ideas, or gives feedback, Claude files it in the right place.
- New documents go in the most specific applicable subfolder.
- `OVERVIEW.md` is updated whenever the core direction shifts.
- `README.md` (this file) stays current with the file index.
- Claude does not ask "where should I put this" — it decides and files it.

### File Index

| File | Summary | Last Updated |
|------|---------|--------------|
| OVERVIEW.md | Core vision and principles for v2 | 2026-03-23 |
| product/FEATURES.md | Master feature inventory — 17 features with descriptions, open questions, discovery notes | 2026-03-23 |
| product/EXPERTS.md | Expert/project workspace model — two access modes, context loading hierarchy, lifecycle, Experts vs. Contacts distinction | 2026-03-23 |
| product/CHAT-TIMELINE.md | Chat timeline model — mixed-content timeline, content types and visual treatments, inline interactive cards | 2026-03-23 |
| product/APP-STRUCTURE.md | App structure — 3 default pages (Chat, Documents, Settings), what lives inside Crosby vs. nav, "Crosby edits its own UI" concept | 2026-03-23 |
| product/EMAIL-MANAGEMENT.md | Email management — full inbox scanning, auto-task creation, inline drafting with send-to-Gmail, always-watching notification model, ripple effects across tasks/watches/contacts/notifications | 2026-03-23 |
| product/CALENDAR-INTEGRATION.md | Calendar integration — confirmation cards for event creation, pre-meeting prep (briefing + session open + push), own-calendar-only for now, ripple effects across contacts/tasks/email/experts | 2026-03-23 |
| product/WATCHES-MONITORS.md | Watches & monitors — auto-creation from context, resolution with context + follow-up, watch vs monitor distinction, staleness escalation, ripple effects | 2026-03-23 |
| product/BRIEFINGS-NUDGES.md | Briefings & nudges — scheduled briefings (morning/afternoon/evening), timer-based + event-driven nudges, distinction table, notification batching, learning from dismissals | 2026-03-23 |
| product/TASKS-COMMITMENTS.md | Tasks & commitments — same system with behavioral distinction, commitment = higher accountability/faster escalation, decision tracking (quiet capture, drift detection, pattern recognition) | 2026-03-23 |
| product/ARTIFACTS.md | Artifacts — Crosby-created documents, side panel display, two-way editing, interactive elements, Expert integration, Documents vs Artifacts distinction | 2026-03-23 |
| product/PROACTIVE-MESSAGES.md | Proactive messages taxonomy — briefings, nudges, heads-ups, catch-ups; anti-overwhelm principle, escalation model, absorption/grouping rules, dedup | 2026-03-23 |
| product/PERSISTENT-MEMORY.md | Persistent memory — four-type model (semantic/episodic/procedural/working), async extraction, hybrid retrieval with RRF + LLM gating, retrieval-time Expert boosting, living mutable greeting, contradiction handling with supersession, email stays in own DB, hover-to-save, known failure modes | 2026-03-23 |
| product/DISCOVERY-STATUS.md | Product discovery status — completed areas, current discussion, outstanding feature areas, key decisions made | 2026-03-23 |
| research/llm-architecture-best-practices-2026-gemini.md | Gemini research report: system prompt architecture, tool design, context management, routing, observability, streaming/error handling | 2026-03-23 |
| research/llm-architecture-best-practices-2026-perplexity.md | Perplexity research report: same topics, with specific tool/provider recommendations (Exa, LiteLLM, Langfuse, Vercel AI SDK 6, semantic tool retrieval) | 2026-03-23 |
| research/nextjs-realtime-architecture-2026-perplexity.md | Perplexity report: streaming (Vercel AI SDK 6), real-time (Supabase Realtime), background jobs (Inngest), codebase structure, Vercel Fluid Compute | 2026-03-23 |
| research/nextjs-realtime-architecture-2026-gemini.md | Gemini report: same topics, with ReAct framework framing, memory tiering, TanStack Virtual, hybrid Vercel+Railway deployment | 2026-03-23 |
| research/database-design-data-sync-2026-perplexity.md | Perplexity report: three-layer data model, entity resolution, conversation schema with context_snapshots, Gmail Pub/Sub sync, calendar syncToken, hybrid RAG with ParadeDB, reranking, Supabase vs Neon/Pinecone | 2026-03-23 |
| research/database-design-data-sync-2026-gemini.md | Gemini report: same topics, with four-tier data model (including graph tier), "Memory Ladder" for conversation history, agentic loop observability, RLS optimization patterns | 2026-03-23 |
| research/plugin-silo-systems-2026-perplexity.md | Perplexity report: MCP as de facto standard (USB-C for AI), silo manifest schema, OAuth-as-a-service (Nango/Composio comparison), Hookdeck webhook ingestion, RLS multi-tenancy, token vault with envelope encryption, security risks (tool poisoning, prompt injection) | 2026-03-23 |
| research/plugin-silo-systems-2026-gemini.md | Gemini report: same topics, with MCP Apps extension (SEP-1865, interactive iframe UIs), Double Hop Tax + Context Window Bloat problems, UTCP as alternative, Progressive Discovery for tool schemas, OAuth 2.1 + PKCE for remote MCP, Nango/Scalekit for OAuth-as-a-Service, multi-tenant Pool/Bridge/Silo models | 2026-03-23 |
| research/testing-qa-strategy-2026-perplexity.md | Perplexity report: DeepEval ToolCorrectnessMetric, behavioral property assertions, LLM-as-judge scoring, shadow evaluation, Langfuse self-hosted stack, implicit failure signals (repetition/correction/abandonment detection), 4-phase implementation roadmap | 2026-03-23 |
| research/testing-qa-strategy-2026-perplexity-v2.md | Perplexity report (second, longer version): three-tier tool verification (structural/logical/semantic), taxonomy of invisible failures (Confidence Trap/Death Spiral/Walkaway/Partial Recovery), Reflexion Pattern for self-correction, Rhesis AI "Penelope Agent" for conversational testing, EU AI Act compliance requirements | 2026-03-23 |
| research/infinite-conversation-memory-2026-perplexity.md | Perplexity report: TiMem 5-level temporal hierarchy (segment→session→day→week→profile), Zep/Graphiti temporal knowledge graph, MemOS MemCube architecture, four-tier memory model (working/episodic/semantic/procedural), RRF hybrid retrieval, supersession-based contradiction handling, XML context injection format, gap-aware greeting UX patterns, Nemori episodic indexing, mem0 + Inngest implementation roadmap | 2026-03-23 |
| research/proactive-ai-behavior-2026.md | Research report: four-gate interruption model, ChatGPT Pulse + Gemini Personal Intelligence analysis, CHI 2025 findings on notification fatigue, four-tier trigger taxonomy (interrupt/session/digest/log), sleep-time compute architecture (Letta), "should I send?" LLM judge pattern, deduplication/cooldown mechanisms, executive assistant proactive communication patterns, 8 specific takeaways for Crosby v2 | 2026-03-23 |
| research/contact-relationship-graph-2026.md | Research report: personal CRM graph architecture (Postgres vs Neo4j), entity resolution across channels (deterministic + probabilistic matching), contact card injection format for LLMs, temporal fact model (Zep/Graphiti pattern), staleness policy, production examples (Clay, Attio, Folk, Superhuman, Zep), disambiguation UX patterns, 8 actionable Crosby v2 takeaways | 2026-03-23 |
| research/conversation-ui-ux-persistent-memory-2026.md | Research report: UI/UX patterns for persistent-memory AI relationships — Pi, Replika, Nomi, Claude, ChatGPT analysis; continuous conversation design (history navigation, virtual rendering, chapter anchors); chat-beyond-bubbles patterns; mobile-first input models; proactive ambient UI (morning brief pattern); memory browser trade-offs; dark-theme visual design direction; 8 actionable takeaways for Crosby v2 | 2026-03-23 |

*(Claude updates this table as files are added or changed)*

---

## Current Status

**Phase: Research & Planning**

We are starting fresh. v1 works but has accumulated structural debt that makes some important things harder than they should be. v2 is an opportunity to design the right foundation before writing a line of code.

Key question we're answering: **What is Crosby, fundamentally, and how should it be built?**
