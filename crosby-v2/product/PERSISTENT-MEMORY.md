# Persistent Memory

*Deep pass complete. Covers memory model, creation, retrieval, lifecycle, visibility, Expert integration, and continuity illusion.*

---

## Core Principle

Memory is what makes Crosby feel like a relationship, not a tool. The user never has to repeat themselves. Crosby proves it remembers by *using* memories naturally in conversation — never by announcing "I saved that to memory." The UX of memory is recall, not storage.

---

## Memory Model (Four Types)

### 1. Semantic Memory — Facts & Preferences
What it stores: accumulated facts, preferences, knowledge about the user and their world.
- "Jason runs 5 pizza restaurants"
- "Jason prefers bullet points over prose"
- "Store #1008's lease is up March 2027"
- "Mike's daughter's name is Sophie"

Retrieval pattern: entity-indexed lookup + vector similarity.
Storage: structured Postgres table with embeddings (pgvector).

Each semantic memory record contains:
- Content text (self-contained, interpretable without surrounding context)
- Importance score (1-10, LLM-rated at extraction time)
- Entity tags (people, businesses, topics, places)
- Created timestamp
- Last-accessed timestamp
- Superseded flag + link to superseding memory
- Confidence score
- Embedding vector

### 2. Episodic Memory — Specific Events
What it stores: narrative accounts of specific events and interactions.
- "Last Tuesday, Jason was frustrated drafting the P&L email — went through 4 revisions before he was happy"
- "Jason and his lawyer spent an hour going through the lease counter-offer on March 5th"

Retrieval pattern: temporal + semantic search, BM25 + vector hybrid.
Storage: dedicated Postgres table with BM25 index + embeddings.

Each episodic memory contains:
- Title (human-readable event description)
- Third-person narrative (preserves salient context, tone, and outcome)
- Keywords
- Entity tags
- Importance score
- Timestamp range (start/end)
- Session reference

Episodes represent **human-scale events**, not individual messages. An LLM boundary-detection step identifies topic shifts and groups related turns into episodes. Typically 5-10 turns per episode.

### 3. Procedural Memory — Behavioral Patterns
What it stores: learned routines, shortcuts, and behavioral rules.
- "When Jason says 'send the numbers' he means the weekly P&L email"
- "Never ask Jason to clarify restaurant names — he'll say 'my pizza place' meaning Mr. Pickles"
- "When Jason says 'run it' on an email draft, send it immediately without confirmation"

Retrieval pattern: trigger/keyword-based lookup (NOT embedding-based). Lightweight classifier checks incoming messages for procedural matches.
Storage: dedicated Postgres table with trigger patterns.

Each procedural memory contains:
- Name
- Trigger pattern (natural language description)
- Action description
- Example invocations
- Confidence score

**Procedural memories need their own retrieval path.** They are pattern-match triggers, not semantically searchable content. A lightweight classifier checks for procedural triggers alongside (not inside) the main retrieval pipeline.

### 4. Working Memory — Current Session Context
What it stores: the live conversation — recent messages in the context window.
No dedicated storage needed — this is the standard conversation context that's already loaded per request. Handled by the existing message history system.

---

## Memory Creation

### Primary: Conversation Extraction (Async)
Memory extraction is the workhorse. It runs on every message — both the user's message and Crosby's response — but **never in the critical path of a response.**

Flow:
1. User sends message → Crosby responds (fast, no extraction)
2. After the response streams back → background job fires
3. Extraction runs against both messages asynchronously
4. Extracted memories are stored with entity tags, importance scores, and embeddings

The extraction LLM must produce **self-contained memories** — each memory must be interpretable without surrounding conversation context. "Jason doesn't want to negotiate lease terms without a broker again" — not "Jason doesn't want to do that again."

### Secondary: Explicit User Save
Two mechanisms:

1. **Natural language** — "Remember that Mike's daughter is Sophie." Crosby saves it directly, bypassing the extraction pipeline. Higher default importance score since the user explicitly asked.
2. **Hover action on messages** — a "remember this" action on any message that force-saves it to memory. Also gets a higher default importance score.

Both are safety nets for when extraction misses something. Extraction should be robust enough that these are rarely needed.

### What Does NOT Write to Memory
- **Email scans** — email data lives in its own dedicated data layer (email summaries, extracted action items, watches). Email content does not become memory. A cron job cross-references the email DB against active tasks, watches, and contacts to surface relevant emails proactively — but without polluting the memory system.
- **Calendar data** — same principle. Calendar is a reference data layer, not memory.
- **Document content** — lives in the document/RAG index, not memory.

**The user can explicitly promote external data to memory** — "remember that Mike's offer was $4.50/sqft from that email" works. But the system never silently converts external data into personal memory.

**Rule: Memory = things Jason said or explicitly saved. Everything else = reference data Crosby can access but doesn't internalize as memory.**

---

## Memory Retrieval

### Hybrid Retrieval with Three Signals
Every retrieval runs three parallel searches:

1. **Vector similarity** (pgvector cosine) — "what's semantically related to what the user just said?"
2. **Entity matching** (structured Postgres query) — "did the user mention a person, place, or project with memories attached?"
3. **Recency + importance weighting** — recent and important memories rank higher

Results are combined using **Reciprocal Rank Fusion (RRF)** — a scoring method that merges rankings from independent signals without needing to normalize across incompatible metrics.

### LLM Recall Gating
After RRF produces a ranked candidate list (top ~15), a fast LLM pass filters it: "Given what the user is asking, which of these memories are actually relevant right now?" This gating step eliminates noise from vaguely-related memories and reduces context length. It runs during response streaming, adding zero perceived latency.

### Complexity-Adaptive Retrieval
Classify each query as simple/hybrid/complex before retrieval:
- **Simple queries** (factual lookups): search semantic memories + profile only
- **Complex multi-hop queries**: search all memory types across all levels

This reduces token consumption for straightforward exchanges without sacrificing depth for complex ones.

### Procedural Memory: Separate Path
Procedural memories are checked via a lightweight trigger-matching classifier that runs alongside (not inside) the main retrieval pipeline. When a procedural match is found, it's injected directly into context — it doesn't go through the RRF scoring.

### Expert Context Boosting (Retrieval-Time, Not Extraction-Time)
When an Expert is active, retrieval boosts memories that are semantically similar to the Expert's description + document context. This is a vector similarity comparison at query time.

**No Expert tagging at extraction time.** Memories are never "routed" to Expert "homes." They live in the global pool with entity tags. The Expert context acts as a retrieval-time boost signal only.

Why retrieval-time over extraction-time:
- Pre-Expert memories surface retroactively when the Expert is created
- Multi-Expert relevance works naturally — both Experts boost the memory when active
- Email/background extraction doesn't need to route to Experts
- Topic drift during conversation doesn't produce mis-tagged memories
- Vague Expert descriptions cause graceful degradation, not data loss

### Separate from Document RAG
Memory retrieval is a **dedicated index** separate from the document/knowledge RAG index:

| Dimension | Document RAG | Conversation Memory |
|---|---|---|
| Data | Static docs, emails, calendar | Dynamic conversation history |
| Retrieval | Semantic similarity | Semantic + recency + entity + temporal |
| Structure | Unstructured text chunks | Structured entities, events, relationships |
| Update frequency | Occasional | Every conversation turn |

---

## Memory Lifecycle

### Contradiction Handling

**In-conversation contradictions:** When Jason says something that conflicts with an existing memory, the extraction pipeline detects it (new memory embedding is semantically similar to an existing memory but says something different). Resolution: **silently supersede the old memory.** The new statement is the truth. No confirmation, no announcement. If it's a major reversal, Crosby may naturally reflect it in conversation ("got it, keeping 1008") but that's conversational, not a system notification.

**Background contradictions (from external data):** Email scans and other external sources do NOT write to memory, so this category is eliminated by design. If the user explicitly promotes external data to memory that conflicts with an existing memory, it's treated as an in-conversation contradiction — the explicit save supersedes.

**Cron-based contradiction scan:** A weekly job scans **only new memories** (created since last scan) against semantically similar existing memories. Scope is proportional to activity, not total history — prevents drift from re-processing.

- Each memory gets a `scanned_at` timestamp
- The cron only processes memories where `scanned_at IS NULL`
- For each new memory, it retrieves top-K semantically similar existing memories and checks for conflicts
- Detected conflicts are queued as gentle questions for the next conversation
- Once scanned, a memory is never re-scanned unless modified

**The anti-drift principle:** The full memory corpus is never re-scanned. Only new memories are checked against existing ones. This prevents the LLM contradiction detector from introducing noise through inconsistent re-processing over time.

### Supersession (Not Deletion)
Old memories are never deleted — they're marked as superseded:

- `superseded_at` timestamp (NULL = currently active)
- `superseded_by` reference to the new memory

Superseded memories are excluded from standard retrieval but preserved for historical queries ("Jason was considering selling Store X back in January"). The version chain is always traceable.

### Strengthening
Memory importance scores adjust passively based on usage:

- **Successful, uncorrected retrieval** → importance ticks up slightly. Memory was useful and accurate.
- **Retrieved but user corrected** → supersession event. No importance bump. Old memory superseded, new one created.
- **Never retrieved** → importance gradually decreases in retrieval ranking (not deleted, just ranked lower over time)

No user action needed. No explicit "strengthen" button. The system learns what matters by observing what keeps coming up.

### No Decay
Memories do not expire or auto-delete. A fact from two years ago is still a fact. Low-importance, never-accessed memories sink in rankings but remain retrievable if specifically relevant.

---

## Memory Visibility (Settings UX)

### Memory Section in Settings
- Shows all memories Crosby has stored
- Grouped by type: **Facts & Preferences** (semantic), **Events** (episodic), **Patterns** (procedural)
- Each memory shows: content, creation date, delete button
- User can **edit** a memory's content (correct something Crosby got wrong)
- User can **search** memories by keyword
- User can **delete** individual memories

### What's NOT Shown
- Importance scores — internal plumbing
- Entity tags — internal plumbing
- Supersession chains — internal plumbing
- Embeddings — internal plumbing

The user sees their memories as a clean, readable list. The infrastructure stays hidden.

### Hover-to-Save on Messages
A hover action on any message in the chat timeline lets the user force-save that message's content to memory. Useful as a safety net when extraction misses something.

---

## The Continuity Illusion

### The Living Greeting
Every time Jason opens the app, there's a message from Crosby. It's an inline message in the timeline — not a floating element, not a special card. Same as any other message, but it can contain structured UI components (calendar summary, task list, etc.).

**Two states:**

1. **Unanswered** — the greeting is a living, mutable message. It regenerates in place whenever Jason returns and meaningful state has changed. Only one unanswered greeting exists at a time. It's not yet a permanent part of the timeline.

2. **Answered** — the moment Jason sends a message, the greeting freezes into a permanent message in the timeline. It scrolls up with everything else, lives in history, and never mutates again. A new greeting won't generate until the next session opens.

**Mutation triggers** (only when the greeting is unanswered):
- Enough time has passed that context has shifted (2hr+ gap / new session)
- An event occurred (watch triggered, email arrived, calendar changed, task came due)
- Day changed

If Jason refreshes 10 minutes later and nothing changed, the same greeting persists. No unnecessary regeneration.

**Lifecycle:**
```
App load → is there an unanswered greeting?
  → Yes, but state has changed → regenerate in place
  → Yes, nothing changed → keep it
  → No (last greeting was answered) → is this a new session?
    → Yes → generate new greeting
    → No → no greeting, just the conversation
```

### Content-Driven, Not Time-Driven
The greeting's substance is determined by **what happened since Jason was last here**, not by how long he's been away. The gap length only affects framing/tone:

| | Nothing happened | Stuff happened |
|---|---|---|
| **Short gap** | No greeting needed, or minimal ("nothing new") | Get to it: "While you were out — vendor replied, 2pm moved to 3pm" |
| **Long gap** | Brief, warm: "Quiet few days. Here's today's calendar." | Fuller context: "It's been a couple weeks. Here's what's active..." |

The activity level determines *whether* to say something substantive. The gap length determines *how much framing* to wrap around it.

### Crosby Always Makes the First Move
Crosby never waits for Jason to ask "what were we working on?" That question exposes the seams of the system. Crosby opens with context. Even on a quiet day with nothing to report, the greeting is warm and human — not "How can I help you today?"

### Graceful Recall Failures
When Crosby can't retrieve a memory the user expects it to have:
- **Never argue** about whether the user said it
- Acknowledge naturally: "I might be fuzzy on the details — can you remind me?"
- Reinforce the memory with a higher importance score after the user restates it
- Log the retrieval failure for analysis (internal, never shown to user)

### Natural Memory Callbacks
Memory feels like natural conversation, not database lookups:

| Breaks the illusion | Maintains the illusion |
|---|---|
| "According to my records from 3 months ago..." | "I remember you mentioned 1008 had lease issues — how'd that go?" |
| "I have no record of that" | "I might be fuzzy on that — remind me?" |
| "I have saved this to memory" | *(silence — proves it later by using it)* |
| "Retrieving relevant memories..." | *(just knows)* |

---

## Known Failure Modes & Mitigations

| Issue | Severity | Mitigation |
|---|---|---|
| **Entity resolution** — inconsistent naming ("Pasadena location" vs "Store 1008" vs "my busiest store") fragments entity matching | **High** | Requires a canonical entity/alias system. Design alongside Contacts feature. |
| **Implicit context memories** — extraction produces orphaned memories that lack context ("doesn't want to do that again") | **Medium** | Extraction prompt mandates self-contained memories. Every memory must be interpretable without surrounding conversation. |
| **Procedural memory retrieval** — pattern-match triggers don't work well with embedding-based search | **Medium** | Separate trigger-based lookup path, not routed through the main retrieval pipeline. |
| **Thin Expert descriptions** weaken retrieval-time boosting | **Low** | Crosby auto-enriches Expert descriptions over time. Entity matching still works as fallback. |
| **Cross-entity synthesis** — system stores individual memories but doesn't build connection graphs between them | **Low** | Acceptable for v2. Individual memories surface via entity tags. Knowledge graph is a v3 feature. |

---

## Ripple Effects

- **Contacts:** Entity resolution is shared infrastructure. Memory entity tags and contact records need a canonical alias system. Design together.
- **Experts:** Memory retrieval boosts based on active Expert context. Expert descriptions auto-enrich from conversation content over time.
- **Tasks & Commitments:** Commitment extraction is a specialization of memory extraction. Commitments are semantic memories with a commitment flag and accountability rules.
- **Watches:** Watch creation from conversation ("I'm waiting on Mike's reply") is a memory extraction event that also creates a watch record.
- **Briefings & Catch-ups:** The living greeting IS the catch-up message from PROACTIVE-MESSAGES.md. Same system, not two separate features.
- **Email:** Email data lives in its own DB, not memory. A cron cross-references email against active tasks/watches/contacts. Users can explicitly promote email content to memory.
- **Training & Learning:** Procedural memory is the foundation for learning user patterns. Training rules are procedural memories with higher confidence thresholds.
