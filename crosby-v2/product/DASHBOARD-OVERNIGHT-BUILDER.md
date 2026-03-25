# Dashboard & Overnight Builder — Product Discovery Notes

*Last updated: 2026-03-24*

---

## What It Is

The dashboard is a collapsible area at the top of the chat — Crosby's canvas for persistent, always-visible information. Unlike timeline cards that scroll away, dashboard widgets stay put and update in real time. It's where Crosby puts things worth checking repeatedly.

The overnight builder is the system that lets Crosby autonomously create dashboard widgets (and other improvements) while the user sleeps. Crosby reviews the day, notices patterns, builds things, and presents them in the morning for approval.

Together, these make Crosby feel like it's working 24/7 — not just responding when prompted.

---

## The Dashboard

### Location & behavior
- **Collapsible dropdown area** at the top of the chat, above the timeline
- **Starts empty/hidden.** New users see no dashboard. It appears once the first widget is created.
- **User can collapse/expand** the dashboard at any time. Collapsed state persists.
- **Always accessible** — even when collapsed, a minimal indicator shows it's there

### Widget system
- Crosby builds widgets from an **existing dashboard component library** (e.g., Tremor or similar React/Tailwind dashboard toolkit) — not freeform code generation.
- The library provides battle-tested, consistent components: metric cards, line/bar/pie charts, tables, lists, status indicators, progress bars, sparklines, scorecards, funnels, heatmaps, activity feeds, calendar previews, countdowns, checklists, and more.
- Crosby knows which components exist and how to configure them with data. It composes the right visualization for the data source. Output is always polished and consistent — no slop.
- Using an existing library means the component set grows with the library's ecosystem, not through custom development.

### Widget data sources
- Widgets can pull from **anything Crosby has access to**: silo integrations (POS, Shopify, etc.), internal app data (tasks, messages, calendar), conversation history, memory, or any combination.
- Not limited to silo data — a widget tracking tasks completed this week pulls from internal data, not an external integration.

### Expert interaction
- When no Expert is active, the dashboard shows all widgets.
- When an Expert is active, **relevant widgets surface to the front** — same pattern as notepad entries. Nothing gets hidden, just reordered.
- Widgets can be tagged to an Expert at creation time based on context.

### User management
- **Rearrange:** User can drag to reorder widgets directly, or tell Crosby to rearrange.
- **Remove:** User can delete widgets directly from the dashboard. Crosby can also remove on request.
- **Modify:** User tells Crosby in chat — "change the time range on that chart" / "add store 2067 to the comparison."
- **Soft delete:** Deleted widgets go to a holding bay for one month before backend removal. Even after that, Crosby retains a **spec** of the widget (what it was, what data it showed, how it was configured) so it can rebuild it if the user wants it back or wants to reference it for a new widget.

---

## How Widgets Get Created

### Three paths to widget creation

**1. Overnight builder (autonomous)**
- Crosby reviews recent days, notices repeated patterns, and builds widgets autonomously overnight.
- Requires a **repeated pattern over ~2 weeks** before Crosby builds unprompted. One-off questions don't trigger builds.
- **Max 2 builds per night.** If Crosby has more ideas queued, it picks the two highest-value and saves the rest for future nights.
- Presents what it built at the morning briefing or first interaction of the following day.

**2. Conversational offer**
- If a topic comes up across **multiple days of chat** (but hasn't hit the 2-week autonomous threshold), Crosby offers: "Want me to build a dashboard widget for this?"
- User approves, Crosby builds it as a background job.

**3. On-demand request**
- User explicitly asks: "Make me a sales tracker" / "Build a widget that shows my task completion rate."
- Crosby runs it as a **background job** so the user can keep chatting.
- When the build finishes:
  - **If the user is actively chatting:** Crosby weaves it in naturally — "By the way, that sales tracker is done — it's on your dashboard, take a look."
  - **If the user is not chatting:** Push notification + message in the timeline saying it's done and to check it out.

---

## The Approval Model

**Crosby always presents what it built for approval before it goes live.** No exceptions, no progressive autonomy on the dashboard. The user should never be surprised by something new appearing.

### How approval works

- **Overnight builds:** Crosby presents the widget in the morning briefing or first interaction. Shows a preview and explains what it is and why it was built. "I noticed you've been checking sales numbers every morning, so I built a dashboard widget that shows daily revenue by store. I can make changes or remove it if you don't like it."
- **Conversational offers:** Crosby offers, user approves the concept, Crosby builds, then presents the result for final approval before it goes live.
- **On-demand requests:** Since the user explicitly asked, the widget goes live when done. Crosby presents it but doesn't gate it behind approval — the ask was the approval.

### After approval
- Widget goes live on the dashboard.
- Crosby mentions it can make changes or remove it.
- User can modify, rearrange, or remove at any time.

---

## The Overnight Builder

### What it does

Every night (or on a configurable schedule), Crosby runs an autonomous review cycle:

1. **Review recent activity** — Scan conversations, action items, questions asked, data checked, tools used, frustrations expressed over the past days/weeks.
2. **Identify opportunities** — What does the user repeatedly check or ask about? What data is being manually requested that could be a widget? What pattern keeps coming up?
3. **Prioritize** — Rank opportunities by estimated value to the user. Pick the top 2 (max per night).
4. **Build** — Assemble widgets from the component library. Configure data connections, refresh intervals, layout.
5. **Queue for presentation** — Store the built widgets for the next morning interaction.

### What it can build

- **Dashboard widgets** — The primary output. Charts, trackers, status boards, metric cards.
- **Widget improvements** — Updating an existing widget based on how the user interacts with it (e.g., adding a data dimension the user keeps asking about).

### What it does NOT build

- The overnight builder focuses on the dashboard. Other autonomous improvements (workflow automations, silo improvements, report templates) are part of the broader silo system and covered in that spec.

### Constraints

- **Max 2 new builds per night.** Quality over quantity.
- **2-week pattern threshold** for autonomous builds. Crosby doesn't jump on one-off interests.
- **Always requires approval.** Nothing goes live without the user seeing it first.
- **Respects quiet hours.** The build runs overnight, but presentation waits for the user's first interaction.

---

## Relationship to Other Systems

| System | Relationship |
|---|---|
| Silos | Silos provide data connections that widgets visualize. Silo-generated widgets follow the same component library and approval model. |
| Training & learning | Learning identifies patterns that trigger overnight builds. The training pipeline is the input; the dashboard builder is one output. |
| Briefings | Morning briefing is the primary channel for presenting overnight builds. Briefing cards are timeline content (scroll away); dashboard widgets are persistent. |
| Experts | Widgets are Expert-tagged. Dashboard reorders based on active Expert context. |
| Structured questions | Approval presentations may use structured question cards (approve / modify / reject). |
| Chat timeline | Dashboard is above the timeline, separate space. Timeline cards are ephemeral, dashboard widgets are persistent. |
| Notepad | Both live in the "Crosby's workspace" mental model. Notepad is temporary working notes; dashboard is persistent visualizations. |
| App manual | Manual should document the dashboard, how to ask for widgets, and how overnight builds work. |

---

## Ripple Effects

- **Chat timeline** — Dashboard area added above the timeline. Collapsible. New notification patterns for build completion.
- **Briefings** — Morning briefing gains "overnight build" section for presenting new widgets.
- **Settings** — May need dashboard preferences (collapsed by default?, overnight builder on/off?).
- **Component library** — New system: a set of predefined UI building blocks Crosby composes from. Needs to be designed and built.
- **Background jobs** — On-demand widget builds run as background jobs with completion notification.
- **Silo spec** — Silo-created widgets should use the same component library and dashboard system.

---

## Open Questions

- [ ] Should the dashboard have a "grid" layout (fixed columns) or a "stack" layout (full-width cards stacked vertically)? Grid is more dashboard-like, stack is simpler on mobile.
- [ ] How do widgets refresh? Real-time (websocket), polling interval (per widget), or on-demand (user pulls to refresh)?
- [ ] Can widgets link to deeper views? E.g., tapping a sales chart opens a detailed breakdown — where does that open? Side panel? Full page? Inline expansion?
- [ ] Should there be a "widget gallery" where the user can browse available widget types and request one? Or is chat the only way to request?
- [ ] How does the component library get extended? Only by developers, or can the overnight builder propose new block types?
- [ ] What's the maximum number of widgets on the dashboard before it gets unwieldy? Should Crosby manage density or is that the user's problem?
