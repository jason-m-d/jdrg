# Artifacts — Product Discovery Notes

*Last updated: 2026-03-23*

---

## What an Artifact Is

An artifact is any document or interactive content that **Crosby creates**. This is the key distinction from Documents — documents are user-uploaded, artifacts are Crosby-generated.

Examples: a marketing plan, a research summary, a checklist, a comparison table, a project brief, a draft proposal.

---

## Documents vs. Artifacts

| | Documents | Artifacts |
|---|---|---|
| Created by | User (upload) | Crosby |
| Source | External files (PDFs, spreadsheets, etc.) | Generated from conversation/research |
| Editable by user | No (view only) | Yes (inline, like a word doc) |
| Editable by Crosby | No | Yes |
| Lives in | Documents page (Documents tab) | Documents page (Artifacts tab) |
| Interactive? | No | Can be (checklists, toggles, etc.) |

---

## Creation & Display

- When Crosby creates an artifact, it **opens in a right-hand side panel** alongside the chat
- The chat continues on the left, the artifact is visible and editable on the right
- After creation, the artifact is saved and appears in the **Artifacts tab** on the Documents page

---

## Editing Model

### Crosby Edits
- Crosby can create and modify artifacts at any time during conversation
- User can ask Crosby to edit ("make the intro shorter", "add a section about pricing")
- Crosby can also proactively update artifacts when relevant information changes

### User Edits
- User can **directly edit the artifact** in the side panel — like editing a Google Doc or Word doc
- No need to tell Crosby to make changes — just type directly
- **Crosby sees all user edits** — changes are visible to Crosby in real-time
- This means the artifact is a two-way collaboration surface, not just a display

### Interactive Elements
- Artifacts can contain interactive components: checkboxes, toggles, selections
- Example: a checklist artifact with checkboxes. When the user checks a box, Crosby knows and can react ("nice, you finished the vendor outreach — want me to draft the follow-up?")
- Interactive state is persisted and visible to both user and Crosby

---

## Recall & Continuity

- When the user references an existing artifact ("let's keep working on our marketing plan"), Crosby **automatically opens it** in the side panel
- Crosby doesn't need to be told to open it — if an artifact exists for the topic, it opens
- This makes artifacts feel like living documents that persist across sessions, not throwaway outputs

---

## Expert Integration

- Artifacts can be **tied to an Expert**
- When an artifact is associated with an Expert, it becomes part of that Expert's knowledge/context
- This means Expert-specific artifacts feed into the Expert's Tier 1/Tier 2 context loading
- Example: a "Marketing Strategy" artifact tied to the Marketing Expert — when the Marketing Expert is active, this artifact's content is available as context

---

## Ripple Effects

- **Documents page**: Needs two tabs now — Documents (user uploads) and Artifacts (Crosby-created). Both are searchable, both are flat lists. Same page, different sources.
- **Experts**: Artifacts tied to Experts add a new dimension to Expert context loading. An Expert's artifacts are high-signal content (Crosby created them specifically for this project) and should likely be Tier 1 or promoted to Tier 1 by the importance scoring cron.
- **Chat timeline**: When Crosby creates an artifact, the chat timeline needs a card/indicator ("I created a marketing plan — it's open in the side panel"). The artifact itself lives in the panel, not inline in the chat.
- **RAG/search**: Artifact content needs to be chunked and embedded just like documents, so it's retrievable in conversation context. Changes to artifacts need re-indexing.
- **Memory**: Artifacts are a form of structured memory — they persist knowledge that Crosby and the user built together. Different from Crosby's internal memory (which the user doesn't see) and different from documents (which are external uploads).
- **Mobile**: The side panel doesn't work on mobile the same way. Need a mobile-specific treatment — probably full-screen artifact view with a way to flip back to chat.
- **Real-time sync**: If the user edits an artifact directly and Crosby sees changes in real-time, there's a sync architecture requirement. WebSocket or Supabase Realtime for artifact state.
- **Conflict resolution**: User always wins. Behavioral editing lock — when the user is actively editing, Crosby cannot write to the artifact. Crosby queues any pending updates and presents them when the user stops editing: "I had some changes for this — want me to apply them?" [Apply changes] [Show me first] [Skip]. If Crosby is mid-generation when the user starts editing, it finishes generating but holds the result as a proposed update instead of writing directly.
- **Versioning**: If both Crosby and the user can edit, there's a question of history. At minimum, artifact edits should be versioned so you can see what changed and when.

---

## Open Questions

- [ ] Can the user create an artifact manually (empty doc from the Documents page), or are artifacts always Crosby-initiated?
- [ ] What types of interactive elements can artifacts contain? Just checkboxes, or richer components (tables, dropdowns, embedded charts)?
- [ ] Versioning — is there an edit history visible to the user?
- [ ] Can an artifact be "detached" from an Expert and become standalone?
- [ ] Can the user share or export an artifact (PDF, email, etc.)?
- [ ] Mobile treatment — full-screen takeover with back-to-chat, or something else?
- [x] ~~Conflict handling~~ → User always wins. Behavioral editing lock: user editing = Crosby can't write. Crosby queues updates and presents them when user stops. See GAPS-AND-CONTRADICTIONS.md #12.
