# Product Discovery — Status & Outstanding Items

*Claude keeps this file current as discovery progresses.*

---

## What We're Doing

We're conducting product discovery for Crosby v2 — a ground-up rebuild. The goal is to produce a micro-detailed PRD that covers every feature, flow, and edge case, detailed enough that Claude Code could one-shot the implementation.

The process: structured interview, one feature area at a time, going deep on each. Every resolved decision gets filed into a dedicated product doc. Open questions and ripple effects are tracked.

---

## Completed Feature Areas

| Feature | Doc | Status |
|---|---|---|
| Feature inventory (17 features) | FEATURES.md | First pass complete — living doc |
| Experts / Projects | EXPERTS.md | Core model resolved (two access modes, context tiers, lifecycle) |
| Chat timeline model | CHAT-TIMELINE.md | Core model resolved (mixed-content timeline, inline interactive cards) |
| App structure | APP-STRUCTURE.md | 3 default pages, chat-native everything else, "edit own UI" concept parked |
| Email management | EMAIL-MANAGEMENT.md | Deep pass complete (scanning, drafting, attachments, watches integration) |
| Calendar integration | CALENDAR-INTEGRATION.md | Deep pass complete (confirmation cards, pre-meeting prep, own-calendar only) |
| Watches & monitors | WATCHES-MONITORS.md | Deep pass complete (auto-creation, resolution, watch vs monitor, staleness) |
| Briefings & nudges | BRIEFINGS-NUDGES.md | Deep pass complete (visual distinction, batching, quiet hours, learning from all actions) |
| Persistent memory | PERSISTENT-MEMORY.md | Deep pass complete (four-type model, async extraction, hybrid retrieval, retrieval-time Expert boosting, living greeting, contradiction handling) |
| Contacts & entity resolution | CONTACTS-ENTITY-RESOLUTION.md | Deep pass complete (two-tier model, entity resolution layers, role aliases, queryable graph, chat-native + side panel UI) |
| Notepad | NOTEPAD.md | Deep pass complete (Crosby's visible working memory, sidebar tab, Expert-tagged, Crosby-set expiry, "noted" indicator in timeline) |
| Training & learning | TRAINING-LEARNING.md | Deep pass complete (all-signal observation, procedural memory storage, confidence model, weekly quiz sessions, settings visibility) |
| Dashboard & overnight builder | DASHBOARD-OVERNIGHT-BUILDER.md | Deep pass complete (collapsible canvas above chat, component library widgets, 2-week pattern threshold, max 2 overnight builds, always-approve, soft-delete with spec retention) |
| Web search & deep research | WEB-SEARCH-DEEP-RESEARCH.md | Deep pass complete (all search via Perplexity, Sonnet never has web search, quick inline + background deep research, reports as artifacts with RAG) |
| Structured questions & quick confirms | STRUCTURED-QUESTIONS.md | Deep pass complete (two levels: timeline cards for clarification + input area chips for simple confirms, confidence-based asking, learned per-user, chaining supported) |
| Mobile experience | MOBILE-EXPERIENCE.md | Deep pass complete (React Native + Expo, native iOS app, monorepo with web, bottom nav, split-view sidebar, rich push notifications, deep linking) |
| Self-aware app manual | APP-MANUAL.md | Deep pass complete (RAG-embedded internal docs, one doc per feature, auto-generated on deploy, source of truth for all capability questions, system prompt defers to manual) |
| Notifications system | NOTIFICATIONS.md | Deep pass complete (no notification center — timeline is inbox, 3 delivery tiers, 3-min batching, quiet hours with breakthrough rules, rich contextual push content) |
| Text / SMS integration | TEXT-SMS.md | Deep pass complete (optional power-user feature, macOS helper app, guided setup wizard, read-only, graceful degradation, manual fallback for non-Mac users) |
| Onboarding / cold start | ONBOARDING.md | Deep pass complete (conversational onboard, email-first "wow" moment, invisible completeness score, bottom sheet OAuth, silent graduation, context-driven integration suggestions) |
| Settings page | SETTINGS.md | Deep pass complete (5 tab groups: Account, Connections, Notifications, Memory & Learning, Preferences. Everything also configurable via chat.) |
| Silos | SILOS.md | Deep pass complete (three tiers: core/marketplace/custom, agentic builder pipeline, cross-silo tunnels, self-healing, credential management, router integration) |

---

## Currently Discussing

**Ready for next feature area.** Settings page complete. All feature areas from the original backlog are now covered.

---

## Feature Areas Still To Cover

- [x] ~~Notifications system~~ → no notification center (timeline is inbox). Three delivery tiers: immediate (watches + breakthrough rules), batched 3-min window (everything else), held until morning (quiet hours). Quiet hours default 9PM–7AM, user-configurable, breakthrough rules for exceptions. Held notifications absorbed into morning briefing. Push content is rich/contextual ("messages from a person"). Per-category toggles in Settings. No badge counts.
- [x] ~~Commitment tracking~~ → same system as tasks with behavioral flag, faster escalation, accountability tone
- [x] ~~Decision tracking~~ → quiet capture, drift detection, pattern recognition ("last time we did X")
- [x] ~~Persistent memory~~ → four-type model (semantic/episodic/procedural/working), async extraction, hybrid retrieval with RRF, retrieval-time Expert boosting, living mutable greeting, email data stays in own DB
- [x] ~~Contacts & entity resolution~~ → two-tier model (shadow records + promoted contacts), layered entity resolution (deterministic → probabilistic → contextual), role aliases with contextual disambiguation, queryable graph via tool, chat-native UI with side panel browse
- [x] ~~Notepad~~ → Crosby's visible working memory (= working memory type from memory spec). Sidebar tab alongside Artifacts + Contacts. Crosby-set expiry per note, Expert-tagged, user can read/edit/delete/pin. "Noted" indicator in chat timeline. Classification at capture: durable facts → memory, temporary context → notepad, ambiguous → memory (safer)
- [x] ~~Web search & deep research~~ → all search via Perplexity (Sonnet never has web search enabled). Quick search = automatic inline via `web_search` tool. Deep research = user-initiated background job via `deep_research` tool, or Crosby suggests it. Reports stored as artifacts with RAG treatment. Delivery varies by user state (chatting → aside, app open → message + sidebar, closed → push notification). Glowing indicator while research runs.
- [x] ~~Training & learning~~ → all-signal observation (engagement, edits, tone, corrections, behavior), stored as procedural memory with confidence levels. Weekly quiz sessions (structured question cards, uncertainty-driven, deferrable). Quiet changes by default, announces significant ones. Read-only "What Crosby has learned" section in settings. Feeds dashboard/overnight builder (separate spec)
- [x] ~~Push notifications~~ → covered in MOBILE-EXPERIENCE.md (APNs via Expo) and NOTIFICATIONS.md (delivery tiers, batching, quiet hours, content design)
- [x] ~~Settings page~~ → 5 tab groups: Account (profile, billing), Connections (Gmail, Calendar, iMessage, silos), Notifications (quiet hours, breakthrough rules, per-category toggles), Memory & Learning (memory browser + read-only learned behaviors), Preferences (tone, response length, language, briefing cadence, overnight builder toggle, quiz sessions toggle). Everything also configurable via chat.
- [x] ~~Onboarding / cold start~~ → conversational onboard (no wizard, no forms). Email is the killer first connection — scans last week, synthesizes "wow" summary. Bottom sheet OAuth (stays in-app). Invisible completeness score tracks coverage not duration. Can complete in one session or over a week. Silent graduation — Crosby just stops asking setup questions. Context-driven integration suggestions (one ask per integration, no nagging).
- [x] ~~Mobile experience~~ → React Native + Expo (native iOS app, not PWA). Monorepo with Next.js web app, shared backend. Bottom nav (Chat, Documents, Experts, Settings). Sidebar slides from right as split-view (top half panel, bottom half chat). Push notifications via APNs — rich, contextual, conversational ("messages from a person"). Deep linking: notification tap → specific message. Ignored notifications handled by catch-up/greeting system.
- [x] ~~Text/SMS integration~~ → optional power-user feature, off by default. macOS menu bar helper app monitors iMessage SQLite DB, forwards to Crosby API. Guided setup wizard. Read-only (can't send). Context + commitment extraction + watch creation from texts. Graceful degradation when Mac is off. Manual fallback (tell Crosby about texts) always available for non-Mac users.
- [x] ~~Dashboard & overnight builder~~ → collapsible canvas above chat, component library (not freeform), Expert-aware reordering, 3 creation paths (overnight autonomous / conversational offer / on-demand request), 2-week pattern threshold for autonomous builds, max 2 per night, always-approve model, soft-delete with 1-month holding bay + spec retained indefinitely, on-demand builds run as background jobs with contextual notification
- [x] ~~Self-aware app manual~~ → RAG-embedded internal docs, one doc per feature area, auto-generated on deploy (no developer maintenance). Source of truth for all capability questions — system prompt defers to manual. Covers features, limitations, interactions, recommendations, tools, background processes. Crosby can confidently answer any question about itself.
- [x] ~~Structured questions & quick confirms~~ → two levels: timeline cards (disambiguation, chaining, quiz sessions) with option chips + "something else", and input area chips (simple confirms above text input). Confidence-based asking, learned per-user via Training & Learning. Cards resolve into Q&A formatted messages. Always-ask for external actions (email send, event creation, deletes).

---

## Key Decisions Made So Far

- 3 default pages: Chat, Documents, Settings. Everything else is chat-native.
- Experts have two access modes (Direct + Ambient) with Tier 1/Tier 2 context loading.
- Chat is a mixed-content timeline — cards, messages, alerts all inline and scrollable.
- Email: full inbox access, continuous scanning, auto-task creation, inline draft editing with Send/Draft buttons.
- Calendar: confirmation cards by default for event creation, pre-meeting prep via briefing + session open + push.
- Watches: auto-created from context, resolve with notification + card + follow-up context, staleness is AI-determined.
- Briefings: 2-3x/day (morning/afternoon/evening), structured dashboard cards, customizable by conversation.
- Proactive messages taxonomy: briefings (scheduled), nudges (cron, escalating), heads-ups (event-driven, never batched), catch-ups (session open after 2hr idle).
- Briefings absorb catch-ups when they overlap. Anti-overwhelm is a core design constraint.
- Nudges escalate over time (gentle → direct → "do it, delegate it, or drop it").
- Crosby learns from every user action — not just dismissals, also engagement, taps, reads.
- Artifacts: Crosby-created documents, displayed in side panel, two-way editable (user + Crosby), interactive elements (checkboxes etc.), tied to Experts as context. Documents page gets Documents tab + Artifacts tab.
- Tasks & commitments: same underlying system, commitment flag changes escalation speed and nudge tone. Commitments never silently expire — Crosby flags first.
- Decisions: quietly logged, surfaced on drift detection, on request, or when similar situations arise.
- Documents: flat list with search, all uploads appear regardless of source, tagged by origin.
- Crosby learns from dismissals to avoid becoming annoying.
- Memory model: four types (semantic, episodic, procedural, working). Semantic = facts/preferences, episodic = events, procedural = behavioral patterns.
- Memory creation: async extraction after every message (never in response critical path). Email/calendar/docs do NOT write to memory — they have their own data layers. Users can explicitly save via natural language or hover-to-save action.
- Memory retrieval: hybrid (vector + entity + recency/importance) with RRF fusion + LLM recall gating. Procedural memories have a separate trigger-based lookup path.
- Expert memory scoping: retrieval-time boosting based on active Expert context — no extraction-time routing. Memories are global, never siloed to Experts.
- Contradiction handling: in-conversation contradictions silently superseded (newer wins). Old memories preserved with supersession chain for historical queries. Weekly cron scans only new memories, never re-scans the full corpus (prevents drift).
- Memory strengthening: importance ticks up on successful uncorrected retrieval. No strengthening on corrected retrieval (that's supersession). Never-retrieved memories sink in rankings but aren't deleted.
- Memory visibility: settings panel with grouped view (facts/events/patterns), search, edit, delete. No internal plumbing exposed.
- Living greeting: inline message that mutates in place until responded to. Regenerates on meaningful state change (events, time gap, day change). Freezes into permanent timeline message once Jason responds. Content-driven (what happened) not time-driven (how long away). This IS the catch-up from proactive messages — same system.
- Email gets its own dedicated data layer. Cron cross-references email DB against active tasks/watches/contacts. Users can explicitly promote email content to memory.
- Entity resolution (inconsistent naming) is the highest-severity known risk — to be designed alongside Contacts. **Resolved** in CONTACTS-ENTITY-RESOLUTION.md: layered resolution (exact match → probabilistic → contextual confirmation), no merge queue, resolutions stored permanently.
- Contacts: two-tier model — shadow records (auto-created, invisible, for entity resolution) + promoted contacts (user-facing). Promotion is automatic and silent based on interaction signals.
- Contact records are thin (identity, channels, relationship type, interaction metadata). Rich facts about people live in memory, linked by entity tags.
- Entity resolution: deterministic first (email/phone), then probabilistic (name similarity + domain + context). No merge queue — Crosby resolves in-context, confirms inline only when stakes are high.
- Role aliases ("my lawyer", "the bookkeeper") extracted implicitly from conversation, contextually disambiguated, shift over time.
- Contact graph is queryable — `query_contacts` tool for natural language questions about the user's network.
- Contacts UI: chat-native by default, side panel for browsing on request. No dedicated page. **Resolved** in CONTACTS-ENTITY-RESOLUTION.md: layered resolution (exact match → probabilistic → contextual confirmation), no merge queue, resolutions stored permanently.
- Self-aware app manual: Crosby has its own feature documentation embedded in RAG. It can search its own manual to answer "can you do X?" and recommend the right feature for a need. Living document — updated and re-embedded when features change.
- Structured questions: Crosby presents interactive cards (option chips, multi-select, yes/no confirms) instead of typing out questions. User taps instead of typing. Falls back to plain text if user types instead.
- Notepad = working memory layer. Crosby's scratch space, visible to user in sidebar. Crosby classifies at capture: durable facts → memory, temporary context → notepad. No staging/promotion workflow.
- Right sidebar is a three-tab panel: Artifacts, Contacts, Notepad. Triggered by a minimal icon in the top right. Remembers last active tab.
- "Noted" indicator appears in chat timeline when Crosby creates a notepad entry — subtle, not a full card.
- Notepad entries are Expert-tagged and surface first when that Expert is active, but all notes are always visible.
- Training & Learning: Crosby learns from all signals (taps, dismissals, edits, tone, corrections, task follow-through, repeated questions). Stored as procedural memory with confidence levels.
- Weekly quiz sessions: structured question cards driven by uncertainty. Deferred sessions keep coming but space out. User can explicitly stop them.
- Learning changes are quiet by default, announced when significant enough that the user would notice.
- Settings gets a "What Crosby has learned" section — read-only, grouped by category. Changes made by telling Crosby in chat.
- Dashboard: collapsible area above chat. Starts empty, grows over time. Crosby builds widgets from a component library (predefined blocks, not freeform). Expert-aware reordering (relevant widgets surface first).
- Overnight builder: 2-week pattern threshold, max 2 builds per night, always presented for approval in morning briefing. User never surprised.
- Three widget creation paths: overnight autonomous, conversational offer (multi-day topic), on-demand user request (background job).
- Widget soft-delete: 1-month holding bay, then Crosby retains a spec indefinitely for rebuilding.
- On-demand builds: if user chatting, Crosby weaves completion in casually. If not chatting, push notification + message.
- All web search via Perplexity — Sonnet never has web search enabled. One provider, one system to tune.
- Quick search: automatic, inline, Perplexity Sonar. Deep research: user-initiated or Crosby-suggested, background job, report as artifact.
- Deep research reports get RAG treatment (tagged `deep_research`) for long-term retrieval.
- Sidebar content is pulled into Crosby's context — user can chat about open artifacts including research reports.
- Structured questions: two levels. Timeline cards for clarification (chips + "something else", resolve into Q&A messages, chainable). Input area chips for simple confirms (lightweight, no timeline card).
- Crosby asks based on confidence level, learned per-user. Some actions always confirm (email send, event creation, deletes).
- "Something else" always available — user is never forced into options that don't fit. User can also ignore chips and type normally.
- Mobile: React Native + Expo, native iOS app, monorepo with web. Full same experience, adapted layout. Bottom nav, split-view sidebar.
- Push notifications: rich, contextual, conversational — "messages from a person." Include surrounding context and what Crosby has done to help.
- Notification tap → deep link to specific message. Ignored notifications woven into catch-up/greeting naturally.
- App manual: RAG-embedded, one doc per feature area, auto-generated on deploy. Source of truth for all self-referential questions. System prompt handles behavior; manual handles knowledge.
- Notifications: no notification center — timeline is inbox. Three tiers: immediate (watches, breakthroughs), 3-min batch (everything else), held (quiet hours → morning briefing).
- Quiet hours: default 9PM–7AM. Breakthrough rules for exceptions ("always notify me if Roger emails"). Held notifications absorbed into morning briefing, not delivered individually.
- Batching: 3-minute window. Multiple items bundled into one rich push. Watch alerts bypass batching.
- No badge counts on app icon.
