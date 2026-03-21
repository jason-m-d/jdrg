# Crosby Product Vision

**Internal north star document. Living doc - update as thinking evolves.**
**Last updated: 2026-03-20**

---

## What Crosby Is Today

Crosby is a private AI executive assistant built bespoke for Jason DeMayo. It manages action items, drafts emails, scans inboxes, tracks sales across 10 restaurant locations, syncs calendars, monitors iMessage, runs morning briefings, and keeps a persistent memory of everything discussed. It's a single-user app with ~32 tools, 7 specialists, 10+ background crons, and a full RAG pipeline for documents and project context.

It works. It's genuinely useful. But it's a custom suit - stitched for one person's exact measurements.

The question: how does this become something anyone would pay for?

---

## The Big Idea: Silos

Crosby's current specialist system (email, calendar, sales, tasks, documents, texts) is hardcoded. A developer had to build each one. The router picks which ones to activate per message, but the set of capabilities is fixed at deploy time.

**Silos flip this.** A silo is a self-contained capability module - a bundle of tools, data connections, UI widgets, background jobs, and prompt context devoted to a specific function. But the key difference from the current specialist system:

**Users create silos by describing what they want in plain language. Crosby builds them.**

"Integrate my Toast POS so I can check sales daily" - and Crosby agentically:
- Researches the Toast API
- Asks the user for API credentials
- Builds the data connection
- Creates a background job to pull sales data on a schedule
- Adds a dashboard widget showing daily/weekly sales
- Writes the prompt context so the chat knows how to query and analyze the data
- Tests the whole thing and confirms it's working

The user never sees code. They just told Crosby what they wanted, and now it can do it.

### Default Silos (Ship With the App)

These are the table stakes - what Crosby needs on day one to be useful:

- **Email** - Gmail/Outlook connection, inbox scanning, drafting, action item extraction, awaiting-reply tracking
- **Calendar** - Google/Outlook calendar sync, availability checking, event creation, meeting prep
- **Tasks** - Action items, assignments, due dates, nudges, follow-up tracking
- **Documents** - Upload, RAG search, artifact creation, version history
- **Notes** - Notepad, memories, decisions, commitments (the "brain" silo)

These are basically what Crosby already has, refactored into the silo architecture.

### User-Created Silos (The Magic)

This is where it gets interesting. Examples of silos a user might create just by asking:

- "Connect to my Shopify store so I can ask about orders and revenue"
- "Monitor my Vercel deployments and alert me when builds fail"
- "Track my portfolio - I use Schwab and Coinbase"
- "Pull in my Notion workspace so I can search it from here"
- "Integrate Slack so I can read and respond to messages"
- "Connect to my restaurant's POS - we use Toast"
- "Set up a weekly digest of my GitHub activity"
- "Monitor my Google Ads spend and alert me if CPA goes above $50"

Each of these becomes a silo with its own tools, data sync, dashboard presence, and chat capability.

### How Silos Get Built (The Agentic Loop)

When a user requests a new capability, Crosby enters a "silo builder" mode:

1. **Research** - Crosby searches for the service's API docs, SDKs, authentication methods. It figures out what's possible.
2. **Plan** - It proposes what the silo will do: "I can connect to Toast and pull daily sales by location. I'll sync every hour and add a dashboard card showing today's revenue. I'll also be able to answer questions like 'how did store X do last week?' Sound good?"
3. **Authenticate** - Asks for API keys, OAuth consent, whatever the service requires. Walks the user through it step by step.
4. **Build** - Creates the data schema, sync jobs, tool definitions, prompt context, and dashboard widgets. All generated, not hardcoded.
5. **Test** - Runs a test pull, confirms data is flowing, shows the user a preview.
6. **Activate** - The silo goes live. The router now knows about it and will activate it when relevant messages come in.

### Silo Interactions

Silos aren't isolated - they can reference each other. This is where compound intelligence emerges:

- "Cross-reference my calendar with my email - if I have a meeting with someone I haven't emailed back, flag it"
- "When my Shopify revenue drops below $X, check if any Google Ads campaigns are paused"
- "After every investor meeting on my calendar, create a follow-up task and draft a thank-you email"

The router determines which silos are relevant to a given message and activates all of them. Silos share a common data layer, so cross-referencing is natural.

### Silo Marketplace (Later)

Eventually, users shouldn't have to build every silo from scratch. A marketplace of pre-built silo templates:

- "Wingstop Franchise Operator" silo (built by Jason, shared publicly)
- "Shopify Store Owner" silo
- "Real Estate Investor" silo
- "Content Creator" silo (YouTube analytics + social + sponsorship tracking)
- "Startup Founder" silo (fundraising pipeline + investor updates + burn rate)

Users install a template, connect their accounts, and they're running. Templates can be customized after install.

---

## Who Is This For?

### Primary Target: Owner-Operators and Solo Executives

People who:
- Run a business (or multiple businesses) and wear many hats
- Don't have a full-time EA or chief of staff (or have one and want to augment them)
- Live in email, calendar, and 5-10 other tools throughout the day
- Are drowning in follow-ups and context-switching
- Would pay real money for something that actually keeps track of everything

**Not** a developer tool. Not a chatbot wrapper. Not a second brain / PKM app. It's a chief of staff that actually does things.

### Why Not Just Use ChatGPT / Gemini / Existing Assistants?

Those are stateless. You ask a question, you get an answer, it forgets. Crosby is:

- **Persistent** - It remembers every conversation, every decision, every commitment. Months of context.
- **Proactive** - It doesn't wait for you to ask. Morning briefings, nudges, email alerts, stale follow-up detection.
- **Connected** - It's wired into your actual tools. Not "tell me what's on your calendar" but actually reading your calendar and correlating it with your email.
- **Self-extending** - The silo system means it grows with you. New tool at work? New business? New workflow? Tell Crosby, and it adapts.
- **Action-oriented** - It doesn't just answer questions. It drafts emails, creates events, manages tasks, generates reports. It does the work.

---

## The Dashboard: Crosby's Face

The dashboard is where silos become visible. Right now it's a chat interface with a sidebar. The vision:

- **Dynamic widgets** - Each silo can add widgets to the dashboard. Sales charts, calendar previews, task lists, inbox counts, portfolio performance, deployment status. The user arranges them.
- **Silo-aware UI** - When you're in "MoneyBall mode" (a project context), the dashboard reshuffles to show relevant widgets. When you switch to "DRG Operations," different widgets surface.
- **Proactive cards** - Crosby pushes cards onto the dashboard: "Roger hasn't responded to your email from Tuesday," "Store 326 sales are 20% below target this week," "You have 3 tasks due tomorrow."
- **Quick actions** - Each widget has contextual actions. The email widget lets you reply inline. The task widget lets you snooze or complete. The sales widget lets you drill into a store.

The dashboard should feel like a personalized command center, not a chat window with a sidebar.

---

## Autonomous Builder (The Overnight Loop)

Inspired by OpenClaw's proactive agent model. The core idea: Crosby doesn't just alert you about things and wait for instructions. It actively builds, improves, and extends itself while you're not using it.

### How It Works

Every night (or on a configurable schedule), Crosby runs an autonomous review:

1. **Review the day** - Scan today's conversations, action items created, questions asked, frustrations expressed, requests that couldn't be fulfilled
2. **Identify opportunities** - What did the user ask for that Crosby couldn't do? What pattern keeps repeating that could be automated? What data is the user manually checking that could be a widget? What silo could be improved?
3. **Build it** - In a sandboxed environment, Crosby creates the thing: a new dashboard widget, a refined report template, a new silo connection, an automation between existing silos, a summary document
4. **Present it in the morning** - The morning briefing includes: "I noticed you've been manually checking Wingstop delivery times in your email every afternoon. I built a widget that pulls that data automatically - it's on your dashboard. Want to keep it?"

### What It Can Build Overnight

- **Dashboard widgets** - "You asked about labor costs 3 times this week. I built a widget that shows labor % by store, updated daily."
- **Report templates** - "You send Roger a weekly sales summary every Monday. I created a template that auto-populates with this week's numbers. Want me to draft it Sunday night?"
- **Silo improvements** - "Your email silo was missing a filter for vendor invoices. I added it - invoices now get flagged separately from general email."
- **New silo connections** - "You mentioned Gusto payroll twice this week. I researched their API - I can connect to it and pull payroll data if you give me your API key."
- **Workflow automations** - "Every time you get a text from Roger about a staffing issue, you create an action item manually. I set up an auto-detect for that pattern."
- **Data analysis** - "I ran a comparison of all 8 Wingstop stores' labor-to-sales ratios for the last 90 days. Store 2067 is consistently 4% higher than the rest. Full breakdown is in your documents."

### The Trust Loop

This only works if the user trusts what Crosby builds. Key principles:

- **Always ask before activating** - Crosby presents what it built, the user approves or rejects. Nothing goes live without consent.
- **Explain the reasoning** - "I built this because you asked about X three times" or "I noticed pattern Y." Transparency builds trust.
- **Easy undo** - If a widget is annoying or a silo is pulling bad data, one message to Crosby disables it.
- **Progressive autonomy** - Start with suggestions only ("I could build X, want me to?"). As trust builds, move to "I built X, it's ready for review." Eventually, for low-risk things, "I added X overnight - let me know if you want changes."

### Why This Matters

This is the difference between a tool and a teammate. Tools wait for instructions. A good chief of staff anticipates what you need and has it ready before you ask. The overnight builder is what makes Crosby feel like it's actually working for you 24/7, not just responding when prompted.

OpenClaw proved this model works for developers. Crosby brings it to non-technical users through the silo architecture - structured, visible, manageable capabilities instead of raw scripts.

---

## Collaboration (The MoneyBall Problem)

Crosby is single-player right now. But real work involves other people. The MoneyBall project exposed this gap: Jason is building a prototype with a cofounder, and Crosby has no awareness of that relationship or ability to facilitate it.

### Shared Projects, Not Shared Accounts

Crosby stays personal - each user has their own instance, their own silos, their own memory. But projects can be shared:

- **Shared project context** - Both cofounders' Crosby instances can read/write to the same project knowledge base. When Jason adds "decided to use The Odds API for MVP" to MoneyBall's context, his cofounder's Crosby knows it too.
- **Cross-instance action items** - "Ask Nate to review the API contract" creates an item that shows up in Nate's Crosby as an incoming request.
- **Cofounder digests** - Each user can opt in to automated project updates. Crosby compiles what happened this week (commits, decisions, action items completed) and sends a digest to collaborators.
- **Shared silos** - A "MoneyBall Development" silo could be shared between cofounders, giving both access to the same GitHub integration, deployment monitoring, and project tasks.

### The Collaboration Layer Is Thin on Purpose

This is NOT a team workspace like Notion or Slack. It's personal assistants that can talk to each other. Each person's Crosby is still theirs - private memories, private email, private preferences. The shared layer is just project context and action items.

This matters because the value prop is "your AI chief of staff" - not "another team collaboration tool."

---

## Technical Architecture (High Level)

### Silo Schema

A silo is a database record with:

```
silo {
  id
  name                    -- "Toast POS", "Email", "Calendar"
  description             -- What this silo does (shown to user)
  type                    -- "default" | "user_created" | "marketplace"
  status                  -- "active" | "building" | "error" | "disabled"

  // Capability definition
  tools[]                 -- Tool schemas (JSON) that this silo provides
  prompt_section           -- System prompt text for when this silo is active
  trigger_rules            -- When to activate (keywords, data dependencies, tool requests)

  // Data layer
  connections[]            -- API credentials, OAuth tokens, webhook URLs
  sync_jobs[]              -- Background job definitions (cron schedule, endpoint, params)
  data_tables[]            -- Dynamic tables this silo created for its data

  // UI layer
  widgets[]                -- Dashboard widget definitions (type, config, position)
  quick_actions[]          -- Contextual actions available from widgets

  // Metadata
  created_by               -- "system" | "user" | "marketplace"
  created_at
  last_synced_at
  error_log[]
}
```

### The Silo Builder Agent

The agent that constructs new silos is itself an AI pipeline:

1. **Intent parsing** - Understand what the user wants connected and what they want to do with it
2. **API discovery** - Web search for API docs, authentication methods, rate limits, pricing
3. **Schema generation** - Define the data tables, tool schemas, and sync job configs
4. **Code generation** - Write the actual sync functions and tool executors (sandboxed, validated)
5. **Testing** - Run the sync, validate data shape, confirm tools work
6. **UI generation** - Create dashboard widgets appropriate to the data type
7. **Prompt writing** - Generate the system prompt section that teaches the chat model about this silo's capabilities

This is a hard problem. It's also the moat. If Crosby can reliably build integrations from natural language descriptions, that's a genuine competitive advantage over every other AI assistant.

### Router Evolution

The current router (Gemini Flash Lite call that classifies intent) needs to become silo-aware:

- It receives the full list of active silos (not just 7 hardcoded specialists)
- For each message, it decides which silos to activate
- It handles silo interactions (activating multiple silos that need to cross-reference)
- It scales gracefully - a user with 20 silos shouldn't see latency degradation

The trigger_rules system already supports this in theory (JSON-serializable, not functions). The router just needs to read rules from the database instead of from hardcoded specialist files.

---

## Monetization

### Pricing Model: Usage-Based with a Base Tier

- **Free tier** - Chat + 3 default silos (email, calendar, tasks). Limited message volume. No custom silos.
- **Pro ($29-49/month)** - All default silos + up to 5 custom silos. Higher message volume. Proactive features (morning briefings, nudges). Document RAG.
- **Business ($79-149/month)** - Unlimited silos. Shared projects. Priority AI models. Custom dashboard layouts. API access for power users.
- **Enterprise** - Self-hosted option. Custom silo development. SLA.

Users pay for the platform. API costs for individual silo integrations (Toast, Shopify, etc.) are either passed through or bundled depending on the service.

### Why People Would Pay

The "would I pay for this?" test, applied to each layer:

- **Default silos alone:** Maybe. Gmail + Calendar + Tasks is crowded. But the proactive layer (morning briefings, follow-up nudges, email scanning) adds real value over static tools.
- **Custom silos:** Yes. "Connect to my POS and show me daily sales" is currently a $500-5000 custom development job. If Crosby does it in 5 minutes from a natural language request, that's a clear 10x.
- **Silo interactions:** Yes. "When X happens in tool A, do Y in tool B" is what Zapier charges $49-149/month for, and Zapier requires manual setup of every automation.
- **Persistent context + proactive intelligence:** Yes. This is the chief of staff value prop. No other consumer AI product does this well.

---

## Competitive Landscape

| Product | What They Do | What Crosby Does Different |
|---------|-------------|--------------------------|
| ChatGPT / Gemini / Claude | Stateless chat, some tool use | Persistent memory, proactive, self-extending |
| Zapier / Make | Workflow automation (manual setup) | Natural language setup, AI-native, conversational |
| Notion AI | Knowledge base + AI | Action-oriented, not just Q&A. Connected to external tools |
| Motion / Reclaim | AI calendar/task management | Broader scope - not just calendar, everything |
| Lindy AI | AI assistant builder | Closest competitor. But Lindy is workflow-first, Crosby is conversation-first with silos as the extension mechanism |
| OpenClaw | Open-source autonomous agent, proactive overnight builds | Same proactive DNA. But OpenClaw is developer-grade (self-hosted, script-based). Crosby packages this for non-technical users through structured silos |

**OpenClaw is the validation.** 247k GitHub stars, viral adoption, proved that "AI builds things while you sleep" is a real product category. But it's a developer tool - you self-host it, configure it, and the outputs are scripts and PRs. Crosby takes the same autonomous builder concept and wraps it in a consumer-grade experience with structured silos, a visual dashboard, and a managed platform. The overnight loop is the same, the packaging is completely different.

**Lindy is the other one to watch.** They're building AI assistants with custom tools and triggers. The difference: Lindy's mental model is "build an automation." Crosby's is "talk to your chief of staff and it figures out the automation." Lindy's advantage is they're further along on the platform/marketplace side.

---

## Phased Roadmap

### Phase 1: Silo Refactor (Current Architecture to Silo Architecture)
- Refactor existing 7 specialists into silo schema
- Move specialist definitions from code to database
- Make the router read silos from DB instead of hardcoded registry
- No new capabilities - just architectural migration
- Dashboard widgets for existing silos

### Phase 2: Silo Builder MVP
- Build the agentic silo creation pipeline
- Support OAuth and API key authentication methods
- Support REST API integrations (covers 80% of use cases)
- Template system for common services (Toast, Shopify, Stripe, etc.)
- User can create, edit, disable, and delete custom silos

### Phase 3: Dashboard + Widget System
- Dynamic dashboard layout (user-arrangeable widgets)
- Widget types: chart, table, count, list, status, timeline
- Silo-generated widgets (the builder agent creates appropriate widgets)
- Project-based dashboard views (switch context, dashboard reshuffles)
- Proactive cards (Crosby pushes alerts and suggestions)

### Phase 4: Collaboration Layer
- Shared projects with cross-instance context
- Assignable action items (to other users)
- Cofounder/team digests (automated project updates)
- Shared silos (both users access same integration)
- Invitation system (email-based, not org management)

### Phase 5: Marketplace + Consumer Launch
- Silo template marketplace (browse, install, customize)
- User-contributed templates (publish your silo for others)
- Onboarding flow (pick your role, get recommended silos)
- Free/Pro/Business tiers
- Marketing site, landing pages, self-serve signup

### Phase 6: Platform
- Public API for silo development
- Webhook support (external services push data into silos)
- Custom UI components (beyond standard widget types)
- Enterprise features (SSO, audit logs, self-hosting)

---

## Open Questions

Things that need answers before building:

1. **Silo builder reliability** - How good can agentic API integration actually be? What's the success rate? What happens when it fails? Need to prototype this with 10-20 real services to understand the failure modes.

2. **Security model** - User-created silos execute generated code. How do we sandbox this? What access does a silo have? Can a malicious silo template exfiltrate data from other silos?

3. **Cost structure** - Each silo adds AI calls (for the builder), storage (for synced data), and compute (for background jobs). How do we price this without losing money on heavy users?

4. **Multi-model strategy** - The builder agent needs a strong model (Claude/GPT-4 class). Background syncs need a cheap model. The router needs a fast model. How do we orchestrate this efficiently?

5. **Migration path** - Current Crosby has a single user's data spread across 15+ tables with no multi-tenancy. What's the migration strategy to support multiple users without breaking the existing setup?

6. **Collaboration complexity** - Shared projects sound simple but have hard problems: conflict resolution, permission models, data isolation. How thin can we keep this layer and still be useful?

7. **The "it just works" bar** - The pitch is "tell Crosby what you want and it does it." If the silo builder fails 30% of the time, the product feels broken. What's the minimum success rate to ship this?

---

## The North Star

A busy person opens Crosby in the morning. Their dashboard shows: today's calendar, overnight emails that need responses, tasks due today, yesterday's sales across their stores, a deployment that failed overnight, and a note that their cofounder pushed a commit to the MoneyBall repo.

They didn't configure any of this manually. They told Crosby about their businesses, connected their accounts, and Crosby built the rest. When they open a new coffee shop next month, they'll say "I just signed a lease for a new location - add it to my operations tracking" and Crosby will ask a few questions and handle it.

That's the product. An AI that actually knows your life and keeps getting smarter about it.
