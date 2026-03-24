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

---

## Currently Discussing

**Ready for next feature area.** Persistent memory complete. Pick any from the backlog below to continue.

---

## Feature Areas Still To Cover

- [ ] Notifications system (push, in-app, batching, preferences) — mostly covered in PROACTIVE-MESSAGES.md, may need technical pass
- [x] ~~Commitment tracking~~ → same system as tasks with behavioral flag, faster escalation, accountability tone
- [x] ~~Decision tracking~~ → quiet capture, drift detection, pattern recognition ("last time we did X")
- [x] ~~Persistent memory~~ → four-type model (semantic/episodic/procedural/working), async extraction, hybrid retrieval with RRF, retrieval-time Expert boosting, living mutable greeting, email data stays in own DB
- [ ] Contacts (auto-creation, enrichment, relationship scoring, UI)
- [ ] Notepad (ephemeral vs persistent, auto-expire, user visibility)
- [ ] Deep research (background execution, report format, delivery)
- [ ] Web search (quick vs deep tiers, inline vs report)
- [ ] Training & learning (what Crosby learns, how, feedback loops)
- [ ] Push notifications (technical: PWA vs native, delivery infrastructure)
- [ ] Settings page (what's configurable, structure)
- [ ] Onboarding / cold start (first-time experience, what Crosby needs to get started)
- [ ] Mobile experience (responsive web, PWA, native?)
- [ ] Text/SMS integration (if in scope for v2)

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
- Entity resolution (inconsistent naming) is the highest-severity known risk — to be designed alongside Contacts.
