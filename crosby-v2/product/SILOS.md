# Silos — Product Discovery Notes

*Last updated: 2026-03-24*

---

## What It Is

A silo is a self-contained capability module — a bundle of tools, data connections, background sync jobs, and prompt context that gives Crosby a new ability. Silos are how Crosby extends beyond its core features to connect with any external service the user needs.

**Silos are capabilities. Experts are context.** An Expert is a workspace where knowledge, files, and instructions live. A silo provides tools and data connections. An Expert might use multiple silos — the "Restaurant Operations" Expert pulls from the Toast silo and the Email silo — but they're different concepts at different layers.

---

## Three Tiers

### Core capabilities
- **What:** Email, Calendar, Tasks, Documents, Notes, Memory.
- **How they work:** Built into Crosby, always there. Native features.
- **Branding:** Called "silos" for consistency but they're really the core product. The user doesn't install or configure them separately (beyond connecting accounts during onboarding).

### Marketplace silos
- **What:** Pre-built silo templates for common services. Toast POS, Shopify, Stripe, Google Ads, Slack, GitHub, Notion, etc.
- **How they work:** User browses the marketplace, taps install, connects their credentials (OAuth or API key via guided flow), and it's live. One-click setup.
- **Who builds them:** Crosby team builds initial templates. Eventually, users can publish their custom silos as marketplace templates.

### Custom silos
- **What:** User describes what they want, Crosby builds it from scratch.
- **How they work:** The user says "connect my Toast POS so I can check sales daily." Crosby agentically researches the API, asks for credentials, builds the data connection, creates tools, sets up sync, and optionally creates dashboard widgets. The user never sees code.
- **The agentic builder pipeline:**
  1. **Intent parsing** — Understand what the user wants connected and what they want to do with it.
  2. **API discovery** — Research the service's API docs, authentication methods, rate limits, pricing.
  3. **Plan & confirm** — Propose what the silo will do. "I can connect to Toast and pull daily sales by location. I'll sync every hour. Sound good?"
  4. **Authenticate** — Walk the user through API keys or OAuth. Bottom sheet browser for OAuth flows.
  5. **Build** — Create the data schema, sync jobs, tool definitions, and prompt context.
  6. **Test** — Run a test pull, validate data shape, confirm tools work.
  7. **Activate** — The silo goes live. The router now knows about it and activates it when relevant messages come in.

---

## Silo Anatomy

Every silo (marketplace or custom) has the same structure:

| Component | Description |
|---|---|
| **Tools** | Tool schemas (what the silo can do — query data, take actions, etc.) |
| **Prompt context** | System prompt section that teaches the chat model about this silo's capabilities |
| **Trigger rules** | When to activate this silo (keywords, data dependencies, tool requests). JSON-serializable, not functions. |
| **Connections** | API credentials, OAuth tokens, webhook URLs |
| **Sync jobs** | Background job definitions (cron schedule, endpoint, params) for keeping data current |
| **Data tables** | Dynamic tables the silo created for its data |
| **Widgets** | Dashboard widget definitions (optional — not every silo needs dashboard presence) |

---

## Cross-Silo Interactions (Tunnels)

Silos can interact with each other through **tunnels** — cross-silo workflows that pull data from multiple silos and produce a combined result.

### How tunnels work
- Each silo is self-contained with its own credentials, sync, and data. Tunnels connect them.
- Example: "Pull in my Toast POS data every day and compare it with Stripe." This creates two silos (Toast, Stripe) and a tunnel between them (daily comparison job).
- Tunnels are workflows that sit on top of silos, not inside either one. If you disconnect one silo, the tunnel breaks cleanly — Crosby knows why and tells you.

### Why two silos, not one
- Different systems = different APIs, credentials, sync schedules. Bundling them creates a messy separation problem.
- Disconnecting one silo shouldn't break the other.
- Tunnels can be added or removed independently of the silos they connect.

### Creation
- User describes the cross-silo behavior they want. Crosby builds the tunnel.
- The overnight builder can also create tunnels autonomously: "I noticed you keep asking me to compare Toast and Stripe numbers, so I set up a daily comparison."

---

## Credentials & Configuration

### User experience
- The user never thinks about credentials as a separate thing. They tell Crosby to connect something, Crosby asks for what it needs (API key, or walks through OAuth via bottom sheet browser), and it's done.
- Crosby handles everything — storage, refresh, rotation. The user doesn't manage credentials directly.

### Settings visibility
- The Connections section in Settings shows all connected silos with status (connected/disconnected/error) and last sync timestamp.
- The user can disconnect or reconnect from Settings, but setup is always through chat.

### Storage
- Credentials are stored securely by Crosby. Encrypted at rest.
- OAuth tokens are auto-refreshed when possible.
- If credentials expire and can't be refreshed, Crosby alerts the user and guides them through re-authentication.

---

## Self-Healing

When a silo breaks (API changes, credentials expire, sync fails), Crosby handles it:

### Automated recovery
1. **Retry** — Transient failures get automatic retries with backoff.
2. **Token refresh** — Expired OAuth tokens are refreshed automatically.
3. **Error diagnosis** — A dedicated repair agent analyzes the failure, checks for API changes, and attempts to fix the silo configuration.

### User escalation
- Only when Crosby genuinely can't fix it on its own.
- Crosby is specific: "Your Toast connection stopped working — looks like your API key was revoked. You'll need to generate a new one in your Toast dashboard. Here's how: [steps]."
- Not vague: never "something went wrong with your integration."

### Status visibility
- Silo health is visible in Settings (Connections section).
- If a silo is erroring, Crosby can mention it proactively: "Heads up — I haven't been able to pull your Toast data for 2 days. The API key might need updating."

---

## Silo Lifecycle

| State | Description |
|---|---|
| **Building** | Crosby is constructing the silo (custom builder or marketplace install in progress) |
| **Testing** | Silo is built, running validation/test sync |
| **Active** | Live and functioning. Router activates it when relevant. |
| **Error** | Something broke. Self-healing in progress or user escalation needed. |
| **Disabled** | User turned it off. Data retained, sync paused, tools unavailable. |
| **Deleted** | User removed it. Soft-delete with 30-day retention, then permanent removal. |

---

## Router Integration

- The router receives the full list of active silos (from the database, not hardcoded).
- For each message, the router reads trigger rules from active silos and decides which to activate.
- Multiple silos can be active for a single message (e.g., user asks something that touches both email and calendar).
- Trigger rules are JSON-serializable and stored in the database. No functions or code — the router evaluates them declaratively.

---

## Silo Marketplace

### For users
- Browse available silo templates by category (commerce, finance, dev tools, communication, productivity, etc.)
- One-click install → credential setup → live.
- Templates can be customized after install (adjust sync frequency, add/remove tools, modify prompt context).

### For creators (future)
- Users can publish their custom silos as marketplace templates.
- Templates are sanitized — no credentials, just the structure (tools, sync config, prompt context, widget definitions).
- Review process TBD.

---

## Relationship to Other Systems

| System | Relationship |
|---|---|
| Experts | Experts are context, silos are capabilities. An Expert can use multiple silos. Silos are not Experts. |
| Dashboard | Silos can optionally produce dashboard widgets. Not required. Widgets follow the same component library and approval model. |
| Router | Router reads silo trigger rules from the database to decide which silos to activate per message. |
| Overnight builder | Can create cross-silo tunnels autonomously based on detected patterns. |
| Settings | Silo connections visible in Settings (Connections section). Status, disconnect, reconnect. |
| Onboarding | Core capabilities (email, calendar) are connected during onboarding. Marketplace/custom silos come later. |
| Background jobs | Each silo defines its own sync jobs. These run on the shared background job infrastructure. |
| App manual | Manual should document available silos, how to request new ones, and how tunnels work. |
| Notifications | Silo errors can trigger proactive notifications (heads-ups). |

---

## Ripple Effects

- **Router** — Must read silo definitions from the database, not hardcoded. Trigger rule evaluation needs to scale to many silos without latency degradation.
- **Database** — Silo schema needs to be flexible enough for arbitrary tool definitions, data tables, and sync configurations.
- **Background jobs** — Silo sync jobs run on the shared infrastructure. Need isolation — one silo's failure shouldn't affect others.
- **Security** — User-created silos execute generated code (tool functions, sync jobs). Needs sandboxing. A malicious or broken silo shouldn't be able to access other silos' data or credentials.
- **Credential storage** — Needs encryption at rest, secure token vault. OAuth refresh token handling.
- **Settings** — Connections section needs to dynamically list all active silos with status.
- **Marketplace infrastructure** — Template storage, install flow, review process (future).

---

## Open Questions

- [ ] How does Crosby validate that a custom-built silo actually works? What's the minimum test coverage before activation?
- [ ] Rate limits — if a silo's API has rate limits, how does Crosby manage them? Does it surface this to the user?
- [ ] Cost pass-through — some APIs cost money (per call, per month). Does Crosby warn the user about costs before building a silo that uses a paid API?
- [ ] Silo versioning — if a marketplace template is updated, do installed instances auto-update or does the user approve?
- [ ] Can silos share data tables? Or is each silo's data fully isolated? (Tunnels query across silos, but is there a shared data layer?)
- [ ] How many silos can a user have before performance degrades? Is there a practical limit?
