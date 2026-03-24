# Contacts & Entity Resolution — Product Discovery Notes

*Deep pass complete. Covers contact model, auto-creation, entity resolution, aliases, queryable graph, UI, and ripple effects.*
*Last updated: 2026-03-24*

---

## Core Principle

A contact is a person in Crosby's address book — someone the user has a relationship with. Contacts are thin, structured identity records. The richness of what Crosby knows about a person lives in memory (semantic, episodic, procedural), linked to the contact by entity tags. The contact record answers "who is this person and how do I reach them." Memory answers "what do I know about them."

---

## Two-Tier Contact Model

### Shadow Records (Tier 1 — invisible)
- Created automatically for every email address and calendar attendee Crosby encounters
- Minimal data: email, name (if available), source, first seen date
- Exist for entity resolution and behind-the-scenes linking
- Never surfaced to the user unless they search for them or Crosby promotes one
- Age out silently if never promoted — kept for resolution but never shown

### Contacts (Tier 2 — user-facing)
- Real people the user has a relationship with
- Full record with all fields
- Visible in the contact list (side panel)

### Promotion Triggers (shadow → contact)
Automatic and silent — Crosby doesn't ask permission:
- Back-and-forth email exchange (not just a one-off inbound)
- User mentions them by name in chat
- They appear on a calendar event where the user is a direct participant (not a 50-person all-hands)
- Crosby creates a task, watch, or commitment involving them
- User explicitly says "add them to my contacts"

### Demotion / Cleanup
- Contacts with no interaction in 6+ months and no active tasks/watches can be auto-archived — hidden from default view, not deleted
- Shadow records that never promote are kept indefinitely for resolution but never surfaced

---

## Contact Record Schema

What lives on the contact record (structured, queryable):
- **Name** — canonical display name + known variants
- **Email addresses** — one canonical, others linked
- **Phone numbers**
- **Company / organization**
- **Role / title**
- **Relationship type to user** — client, vendor, employee, friend, family, lawyer, etc.
- **How they met / source of first contact**
- **Channel identifiers** — Google contact ID, etc.
- **Last contact date + channel**
- **Interaction frequency / relationship strength score**
- **Status** — active, dormant, archived

What does NOT live on the contact record:
- Facts about the person ("has two kids", "prefers morning calls") → semantic memory tagged to this contact
- Behavioral observations ("always sends invoices late") → procedural memory tagged to this contact
- Interaction narratives ("was frustrated about the lease counter-offer") → episodic memory tagged to this contact

The contact is the identity spine. Memory is the richness.

---

## Entity Resolution

### The Problem
"Sarah Johnson" in Gmail, "SarahJ@uplandco.com" in the address book, "Sarah" in a text thread, and a calendar invite from "s.johnson@uplandco.com" are all the same person. Crosby needs to know this without being told.

### Resolution Layers (high confidence → low confidence)

**Layer 1 — Exact match (instant, automatic):**
- Same email address → same record. Always.
- Same phone number (normalized: strip country code, spaces, dashes) → same record.

**Layer 2 — High-confidence merge (automatic, silent):**
- Different email, same domain + high name similarity (Jaro-Winkler > 0.9) → auto-merge
- Example: `sarah@uplandco.com` and `s.johnson@uplandco.com` where the calendar event says "Sarah Johnson"
- Confidence > 0.9 → merge silently

**Layer 3 — Contextual resolution (Crosby decides or confirms):**
- Confidence 0.7–0.9 → Crosby uses conversational context to make the call
- If obvious from context, merge silently
- If ambiguous, confirm inline: "Is the Sarah Johnson who emailed you the same Sarah from the Upland lease?"
- Resolution stored so it never asks again

**Layer 4 — Distinct records:**
- Confidence < 0.7 → treat as separate people

### Key Rules
- **Canonical email is the identity spine.** Every contact has one primary email. Other emails link to the same record via a channels table.
- **Same domain ≠ same person.** `patricia@smithfamily.com` and `bob@smithfamily.com` are different people, possibly related (flag a potential relationship edge).
- **Never auto-merge on name alone.** Name-only matches require a second signal (domain, co-occurrence, conversation context).
- **No merge queue.** Crosby doesn't maintain a settings page of merge candidates. It resolves in-context when it matters.
- **Every resolution is stored.** Once Crosby resolves an ambiguity, it never asks the same question again.

### Resolution UX
- Crosby resolves silently when confident
- When not confident, picks the most likely match and confirms inline: "Drafting for John Mitchell, your accountant — that right?"
- Only fully blocks (presents options) when there's genuine ambiguity with real stakes — before sending an email or creating a calendar event with the wrong person
- Confirmations include enough context to make the choice obvious: name + role + last contact date

---

## Role Aliases

Users refer to contacts by role: "my lawyer", "the bookkeeper", "the Upland vendor", "the contractor."

### How Aliases Are Created
- **Implicitly** — extracted from conversation and email. "I'm meeting with my lawyer Mike tomorrow" → Mike gets the alias "my lawyer."
- **Explicitly** — "Mike is my lawyer" → direct alias assignment.
- **From relationship type** — when a contact's relationship type is "lawyer", the alias "my lawyer" auto-maps.

### How Alias Resolution Works
- One match → resolve silently
- Multiple matches → confirm inline with context: "Do you mean Mike Chen (real estate, last emailed March 10) or David Park (corporate)?"
- After disambiguation, Crosby stores the contextual mapping: when talking about leases, "my lawyer" = Mike Chen

### Alias Properties
- **Additive, not exclusive.** One contact can have many aliases: Mike is "my lawyer", "Mike", "Mike Chen", "the real estate attorney."
- **Context-sensitive.** In a lease discussion, "my lawyer" resolves to Mike. In a corporate matter, it resolves to David.
- **Can shift over time.** "I'm switching to a new attorney, Lisa Park" → "my lawyer" migrates to Lisa. Mike keeps his record but loses the active alias.

---

## Queryable Contact Graph

The contact graph is a first-class query target, not just backend infrastructure. The user can ask natural language questions about their network and get real answers.

### `query_contacts` Tool
Handles queries like:
- "Who do I know at Upland?"
- "When did I last talk to Sarah?"
- "Who have I not talked to in over a month?"
- "List everyone involved in the lease deal"
- "Who's my most active contact this week?"
- "Who do I know at construction companies?"

### Query Capabilities
- **Filter by attribute:** company, role, relationship type, location
- **Filter by interaction:** last contacted before/after date, interaction frequency, channel
- **Filter by status:** active, dormant, has open tasks/watches
- **Filter by relationship:** "who do I know through Mike", "everyone involved in the Upland deal"
- **Aggregations:** "who have I emailed the most this month", "who am I overdue to follow up with"
- **Relationship traversal:** "who introduced me to Sarah" (if that edge exists)

The model translates natural language into structured queries. Results come back as compact contact cards.

---

## UI Surface

### Chat-Native by Default
- All contact interactions happen through conversation
- "Who is Sarah?" → contact card inline
- "Update Sarah's phone number" → Crosby does it
- "Add Mike to my contacts" → done

### Side Panel for Browsing
- User asks "show me my contacts" or "pull up my contact list" → opens in the right-hand side panel (same panel used for artifacts)
- Searchable list
- Tap a contact → full detail card (name, channels, relationship type, last contact, linked memories/tasks/watches)
- Inline edit capability (tap to change phone number, role, etc.)
- No dedicated page. No nav entry. Appears when you need it.

---

## Ripple Effects

### Contacts × Email
- New correspondents create shadow records; promote on real interaction
- Email scanning updates `last_contact` on the contact record
- "Email Sarah" resolves to a contact and pulls the right email address
- Contact card injected into context when composing

### Contacts × Calendar
- Meeting attendees create shadow records; promote for small direct meetings
- Pre-meeting prep (briefing system) pulls contact cards for attendees — Crosby tells you what you know about each person before the meeting

### Contacts × Memory
- Memories are tagged with contact entity references
- When a contact is active in conversation, Crosby boosts retrieval of memories tagged to that contact
- "What do I know about Sarah?" triggers both a contact card lookup AND a memory retrieval filtered by that entity tag

### Contacts × Watches / Tasks
- Tasks and watches can reference contacts ("waiting on Sarah's response")
- When a watch resolves (email arrives from Sarah), the contact's `last_contact` updates

### Contacts × Experts
- An Expert like "Upland Lease Deal" can have linked contacts (the 5 people involved)
- When the Expert is active, contact cards for linked people are available for Tier 2 retrieval (pulled in when relevant, not always loaded)

### Contacts × Briefings
- Morning briefing can include "people to follow up with" based on interaction recency and open threads
- Contact relationship strength informs nudge priority

---

## Open Questions

- [ ] Should Crosby auto-detect relationship type from email signatures / context, or only assign it when the user states it explicitly?
- [ ] Interaction frequency / relationship strength score — is this a simple count, a decaying metric, or AI-assessed?
- [ ] Should contacts have a "notes" field the user can edit directly, or is that just memory?
- [ ] Multi-user future: if Crosby becomes multi-user, are contacts per-user or shared within a team/household?
- [ ] External enrichment (LinkedIn, public data) — in scope for v2, or deferred?
