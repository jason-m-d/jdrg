# Briefings & Nudges — Product Discovery Notes

*Last updated: 2026-03-23*

---

## Briefings

### What They Are
Comprehensive "here's your world" summaries delivered at set times. Think of them as a personal daily briefing from a chief of staff.

### Default Cadence
- **Morning** (~8am), **afternoon**, and **evening** — three per day by default
- Times are configurable — user tells Crosby "I start my day at 6am" or adjusts in Settings
- User can also change which briefings they get ("I don't need an evening briefing")

### Morning Briefing Sections (default)
- Weather
- Top headline news
- Today's calendar — meetings with prep context (clickable for fuller prep)
- Overnight email highlights — what came in, what needs attention
- Active watches update — anything resolved overnight, anything going stale
- Stale/overdue tasks
- Commitments due today or upcoming
- Expert updates — anything relevant across active projects

All sections are **customizable** — user tells Crosby what to include/exclude ("don't include news", "add my portfolio performance"). No Settings UI needed for this — it's conversational.

### Afternoon/Evening Briefings
- Lighter weight than morning
- Afternoon: mid-day check-in, things that happened since morning, anything needing attention before end of day
- Evening: wrap-up, what got done, what's carrying over to tomorrow
- Structure TBD — may be more fluid than the morning briefing

### Visual Treatment
- Delivered as a **structured card** in the chat timeline (see CHAT-TIMELINE.md)
- Dashboard-like layout with sections — not a wall of text
- Interactive — individual items are tappable/clickable for more detail or action

---

## Nudges

### What They Are
Shorter, more frequent, more reactive. Nudges are Crosby noticing something needs attention and poking the user about it. They're the "alive" feature — what makes Crosby feel proactive rather than reactive.

### Two Trigger Types
> **Note:** Event-driven alerts (watch resolutions, urgent emails, monitor matches) are classified as **heads-ups** in the proactive messages taxonomy (see PROACTIVE-MESSAGES.md). They're included here for context since this spec was written before the taxonomy was finalized. Nudges proper are timer/cron-based accountability messages. Heads-ups are immediate, event-driven alerts.

**Timer-based:**
- Runs on a configurable interval (default TBD — every few hours?)
- Checks for: stale tasks, overdue items, unanswered emails, commitments approaching deadline, watches going stale
- Surfaces top 3-5 items needing attention
- "Hey, a few things on your radar" energy

**Event-driven (reactive):**
- Triggered by something happening in the real world
- Watch resolution: "John replied to your email about the contract"
- Email alert: a monitored pattern matched
- Calendar: upcoming meeting in 30 minutes
- Commitment: something is due today
- These are more like alerts than nudges — they're reactions to events, not periodic check-ins

### Visual Treatment
- Event-driven alerts and timer-based nudges have **different visual treatments** in the UI
- Alerts (watch resolutions, urgent emails, monitors firing) should feel more immediate and important
- Timer nudges ("3 things on your radar") should feel calmer, more like a check-in
- Exact design TBD but the distinction is intentional — not all nudges are created equal

### Notification Batching
- **Urgent/watch-related notifications are never batched** — they push immediately
- Everything else gets **batched on a ~5 minute window** — if multiple things happen in quick succession, Crosby groups them into one push notification
- When the user opens the app, individual items are visible as separate cards/items in the timeline

### Quiet Hours
- **Default: 9:00 PM – 7:00 AM** (user's local time). User-configurable in Settings or conversationally ("don't nudge me after 10pm").
- During quiet hours, all notifications are held and absorbed into the morning briefing. No flood of individual notifications when quiet hours end.
- **Breakthrough rules** allow exceptions: the user tells Crosby what should always get through ("always notify me if Roger emails", "break through for deployment failures"). Stored as persistent rules.
- See NOTIFICATIONS.md for the full quiet hours and delivery tier spec.

### Delivery
- **Push notification** — for both types (respecting batching rules and quiet hours)
- **Inline chat card** — appears in the timeline
- Nudge cards are compact — a short line of prose + a few interactive items
- Event-driven alerts include context (what happened, what Crosby thinks you should do about it)

---

## The Distinction

| | Briefings | Nudges |
|---|---|---|
| Frequency | Finite, scheduled (2-3x/day) | Ongoing, as needed |
| Trigger | Time-based only | Time-based / cron (event-driven alerts are "heads-ups" — see PROACTIVE-MESSAGES.md) |
| Scope | Comprehensive — everything relevant | Focused — specific items |
| Tone | "Here's your world" | "Hey, don't forget" or "This just happened" |
| Length | Longer, structured sections | Short, 3-5 items or single alert |
| Contains new info? | Yes (overnight recap, etc.) | Yes (watch resolutions, email alerts, etc.) |

---

## Ripple Effects

- **Notification system**: Briefings and nudges are the two heaviest users of push notifications. Need smart batching — if 3 event-driven nudges fire within 5 minutes, batch them into one notification instead of spamming.
- **Training/learning**: Crosby learns from **every user action** — not just dismissals. Taps, reads, ignores, engagement depth, which briefing sections get opened, which nudge items get acted on. If the user always reads the email section but never opens weather, weather gets deprioritized over time. This is the core anti-annoyance mechanism.
- **Email scanning**: Email is a major source of both briefing content and event-driven nudges. The email scanner needs to classify emails by urgency to determine whether something warrants an immediate nudge vs. waiting for the next briefing.
- **Watches**: Watch resolutions are a primary source of event-driven nudges. The watch system and nudge system need tight integration.
- **Settings**: Briefing timing, nudge frequency, and notification preferences are all Settings items. These are also conversationally configurable ("Crosby, stop nudging me about email on weekends").
- **Experts**: Expert-specific activity might generate nudges ("your Upland property Expert has new information — the listing price dropped"). Experts as a nudge source.

---

## Open Questions

- [ ] What's the default nudge interval for timer-based nudges?
- [x] ~~Should event-driven nudges have urgency tiers?~~ → Yes. Urgent/watch = immediate push. Everything else batched ~5min.
- [ ] Do nudges have an "acted on" state? If you tap a nudge item, does it visually change?
- [ ] Can the user snooze a nudge? ("Remind me about this in 2 hours")
- [ ] Afternoon and evening briefing structure — same sections as morning, or different?
- [x] ~~Do briefings get smarter over time?~~ → Yes. Crosby learns from every action — engagement, dismissals, taps, ignores. Sections get deprioritized or promoted based on behavior.
