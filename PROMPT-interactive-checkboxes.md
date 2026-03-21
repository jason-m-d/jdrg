# Feature: Interactive Checkboxes - Artifacts + Chat Action Item Cards

Two features that share checkbox visual components but use different data sources. Build in order - Part 1 first (simpler), then Part 2.

---

## Part 1: Interactive Checkboxes in Artifacts

When an artifact contains `[ ]` or `[x]` list items (like in a plan or checklist), render them as clickable checkboxes instead of static text. Clicking a checkbox toggles it, and the change auto-saves to the artifact. Since artifact content is already loaded into the system prompt, Crosby can see what's been checked with zero extra work.

### 1A. Modify `FormattedContent` to support checkbox rendering

**File:** `src/components/chat-messages.tsx`

`FormattedContent` currently takes `{ content: string }`. It needs two new optional props:

```typescript
interface FormattedContentProps {
  content: string
  onCheckboxToggle?: (lineIndex: number, checked: boolean) => void
}
```

In the line-by-line parser, add detection BEFORE the existing bullet/numbered list handling (lines 667-683). When a line matches `- [ ] ` or `- [x] ` or `* [ ] ` or `* [x] ` (or numbered: `1. [ ] `), render a checkbox variant instead of the normal bullet:

```
- [ ] Some task     -->  interactive unchecked checkbox + "Some task"
- [x] Done task     -->  interactive checked checkbox + strikethrough "Done task"
```

If `onCheckboxToggle` is NOT provided, render the checkboxes as static (read-only). This keeps the component backward-compatible for chat messages and other places that render `FormattedContent` without interactivity.

**Checkbox visual design (match the existing aesthetic):**
- Replace the bullet dot with a 14px square box: `border border-border/60 rounded-[3px]`
- Unchecked: empty box
- Checked: box with `bg-muted-foreground/20` fill and a small `Check` icon (Lucide, `size-2.5`) in `text-muted-foreground`
- Checked text: add `line-through text-muted-foreground/50` to the label span
- Hover on unchecked: `border-muted-foreground/60` transition
- Click: 150ms scale animation (scale-95 -> scale-100)
- The checkbox must be a `<button>` for accessibility, not just a styled div with onClick

### 1B. Wire up checkboxes in `ArtifactPanel`

**File:** `src/components/artifact-panel.tsx`

The artifact panel already renders content with `<FormattedContent content={active.content} />` (around line 301). Change this to pass the new prop. **Read the file first** to confirm the exact name of the content update function (it may not be called `handleContentChange` - find the function the edit textarea uses for its onChange/debounced save and use that same path).

```tsx
<FormattedContent
  content={active.content}
  onCheckboxToggle={(lineIndex, checked) => {
    // Toggle [ ] <-> [x] in the content string at the given line
    const lines = active.content.split('\n')
    const line = lines[lineIndex]
    if (checked) {
      lines[lineIndex] = line.replace('[ ]', '[x]')
    } else {
      lines[lineIndex] = line.replace('[x]', '[ ]')
    }
    const newContent = lines.join('\n')
    // Use the existing content update mechanism (the same one the edit textarea uses)
    // This triggers the existing debounced auto-save
    handleContentChange(newContent)  // <-- confirm actual function name
  }}
/>
```

The artifact panel already has debounced auto-save with version snapshotting when you edit in the textarea. The checkbox toggle should use that exact same save path. Don't create a separate save mechanism.

**IMPORTANT - Rapid toggle race condition:** If the user clicks two checkboxes quickly before the debounce fires, the second toggle reads stale `active.content` (without the first toggle applied) and overwrites it. Fix this by using a `useRef` that always holds the latest content string. The `onCheckboxToggle` callback should read from the ref, not from the rendered `active.content`. Update the ref every time content changes (from debounced saves, checkbox toggles, or edit mode changes). Example pattern:

```tsx
const contentRef = useRef(active.content)
useEffect(() => { contentRef.current = active.content }, [active.content])

onCheckboxToggle={(lineIndex, checked) => {
  const lines = contentRef.current.split('\n')
  // ... toggle logic ...
  const newContent = lines.join('\n')
  contentRef.current = newContent  // update ref immediately
  handleContentChange(newContent)
}}
```

**Important:** Checkboxes should work in VIEW mode (not just edit mode). The user shouldn't have to switch to edit mode to check things off. But the edit mode textarea should also reflect the toggled state (since it's the same content string).

### 1C. System prompt update for checkbox formatting

**File:** `src/lib/system-prompt.ts`

In the "RULES for managing artifacts" section (around line 457), add this rule:

```
- When creating checklist or plan artifacts with actionable items, use markdown checkbox syntax: `- [ ] Item text` for incomplete items and `- [x] Item text` for completed items. Jason can check these off interactively in the side panel, and you can see the updated state. When you see [x] items, acknowledge they're done without re-listing them.
```

Also add to the artifact type guidance: when `type: 'checklist'`, ALWAYS use `[ ]` / `[x]` syntax. For `type: 'plan'`, use it on actionable line items but not on section headers or informational bullets.

### 1D. No new database tables needed

Artifact checkboxes don't need any new storage - the checked state is just part of the artifact content (`[ ]` vs `[x]`), which is already persisted and versioned.

### 1E. Manual checkbox entry

If a user manually types `- [ ] item` in the artifact edit textarea and switches to view mode, it should render as a checkbox automatically. This works for free if `FormattedContent` handles the `[ ]` / `[x]` pattern - just confirm it does.

---

## Part 2: Interactive Action Item Cards in Chat Messages

Instead of rendering action items as plain text bullet lists in chat messages, render them as interactive card components with checkboxes. This is driven by **tool calls, not formatting tags** - when Crosby calls `manage_action_items` with `create`, the created items render as cards with checkboxes inline in the message. No AI tagging, no formatting rules to forget, no silent failures.

### Why tool-based instead of text-based

The previous approach relied on the AI prefixing list items with `[action]` - a formatting convention models can forget, especially in longer responses. Tool calls are structural: either the tool was called or it wasn't. The `manage_action_items` tool already returns the created item with its ID, title, and priority. We use that data directly.

### 2A. Upgrade `ActionItemCard` to include a checkbox

**File:** `src/components/chat-messages.tsx`

The existing `ActionItemCard` component (around line 701) renders a small status bar after tool calls:

```tsx
// Current: static status card
<div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
  <Icon className={cn("size-3 shrink-0", config.color)} />
  <span className="text-muted-foreground">{config.label}:</span>
  <span className="text-foreground/80 truncate">{item?.title || 'Unknown'}</span>
  {item?.priority === 'high' && (
    <span className="text-[0.625rem] uppercase tracking-wider text-red-500/70 ml-auto shrink-0">high</span>
  )}
</div>
```

Modify this so that when `operation === 'create'`, the card includes an interactive checkbox:

```tsx
// New: interactive card for created action items
<div className="flex items-center gap-2 text-[0.75rem] border border-border px-3 py-2">
  <ActionItemCheckbox itemId={item.id} initialStatus={item.status} />
  <span className={cn(
    "text-foreground/80 truncate flex-1",
    isCompleted && "line-through text-muted-foreground/50"
  )}>
    {item?.title || 'Unknown'}
  </span>
  {item?.priority === 'high' && (
    <span className="text-[0.625rem] uppercase tracking-wider text-red-500/70 ml-auto shrink-0">high</span>
  )}
</div>
```

For other operations (`complete`, `update`, `dismiss`, `snooze`), keep the existing static display - those are confirmations, not interactive items.

### 2B. New component: `ActionItemCheckbox`

**New file:** `src/components/action-item-checkbox.tsx`

A small client component that reads and writes directly to the `action_items` table:

```typescript
interface ActionItemCheckboxProps {
  itemId: string           // action_items.id - exact, not fuzzy
  initialStatus: string    // 'pending' | 'approved' | 'completed' | 'dismissed'
}
```

Behavior:
- Renders the same 14px checkbox visual as Part 1 (reuse the same styled button)
- Checked = status is `completed`. Unchecked = anything else.
- On mount: fetch the current status from Supabase (`SELECT status FROM action_items WHERE id = $1`). Store it as both `currentStatus` and `previousStatus` in component state. This ensures the card reflects the real current state, not the state at tool-call time.
- On check (marking complete): optimistically toggle UI, update action_item status to `completed`
- On uncheck: restore to `previousStatus` (not hardcoded `pending`). This matters because items can be `approved` before completion - blindly setting `pending` on uncheck would lose that state. The `previousStatus` is captured on mount from the real DB value.
- If the update fails, revert the optimistic state
- Uses `getSupabaseBrowser()` (same pattern as `InlineActionButtons` in `src/components/inline-action-buttons.tsx`)

The key advantage: this writes directly to the `action_items` table. No shadow `message_checkboxes` table. No new API routes. The action item IS the source of truth.

### 2C. Make cards reflect current status on load

The `actionItemEvents` data stored on messages contains the item state AT THE TIME the tool was called (verify this by reading how `actionItemEvents` is stored/loaded in `chat-messages.tsx` and the chat route before building). The item's status may have changed since then (checked off elsewhere, snoozed, dismissed). The card should show current state.

The `ActionItemCheckbox` component handles this via its on-mount fetch (described in 2B above). One tiny Supabase query per action item card, only for visible messages. This is fine for v1.

**Future optimization if needed:** If someone has a long conversation with dozens of action item creates, scrolling back could fire a burst of individual queries. If this becomes noticeable, batch the IDs and do a single `SELECT * FROM action_items WHERE id IN (...)` at the message list level, then pass results down. Don't build this now - optimize when you see the problem.

### 2D. System prompt update - stop listing action items as text

**File:** `src/lib/system-prompt.ts`

Add a rule to the action items / response formatting section:

```
RULE - Action Item Display:
When you create action items using the manage_action_items tool, do NOT also list them as bullet points in your text response. The UI automatically renders created action items as interactive cards with checkboxes. If you list them as bullets AND they render as cards, the user sees duplicates.

Instead, after creating action items, write a brief conversational summary like "Got it, I've added those 3 items to your list" or "Tracked - here's what I'm following up on." The cards handle the details.

Exception: if you're DISCUSSING existing action items (not creating new ones), you can reference them in prose normally.
```

This is important. Without this rule, the AI will call the tool AND write "Here are your action items: - Follow up with Roger - Send Jenny the SOP" - and the user sees both the text list AND the cards, which is redundant.

### 2E. Prompt rule - always use the tool for action items

**File:** `src/lib/system-prompt.ts`

Strengthen the existing action items rules to make tool usage mandatory:

```
RULE - Always Create Action Items via Tool:
When action items come up in conversation (whether you're proposing them, extracting them from context, or Jason mentions things he needs to do), ALWAYS create them using the manage_action_items tool. Do not just list them as text bullets without creating them. If it's an action item, it goes in the system.

This ensures every action item is tracked and interactive in the UI. Text-only action items are invisible to the tracking system.
```

### 2F. No new database tables or API routes needed

This is the big win of the tool-based approach:
- No `message_checkboxes` table
- No `/api/message-checkboxes` route
- No label hashing or seeding logic
- No race conditions on first render
- The `action_items` table is the single source of truth
- `ActionItemCheckbox` talks directly to Supabase via the browser client (same pattern as `InlineActionButtons`)

---

## Key Files Summary

**Modified files:**
- `src/components/chat-messages.tsx` - `FormattedContent` gets `[ ]`/`[x]` checkbox rendering (Part 1). `ActionItemCard` gets interactive checkbox for `create` operations (Part 2).
- `src/components/artifact-panel.tsx` - Pass `onCheckboxToggle` to `FormattedContent`, handle content updates via existing auto-save
- `src/lib/system-prompt.ts` - Artifact checkbox syntax guidance + "don't duplicate action items as text" rule + "always use the tool" rule

**New files:**
- `src/components/action-item-checkbox.tsx` - Reusable checkbox component that reads/writes action_items status via Supabase browser client

**No new DB tables. No new API routes.**

---

## Design Constraints

- Use semantic Tailwind tokens only (`text-muted-foreground`, `border-border`, etc.) - never hardcode hex/rgb
- Checkbox: 14px square, `border-border/60`, `rounded-[3px]`. Subtle, minimal, matches the dark utilitarian aesthetic.
- Checked state: `line-through` + `text-muted-foreground/50` on the label text
- 150ms transition on check/uncheck
- Use `<button>` elements for checkboxes (accessibility)
- Don't install any external checkbox/markdown libraries
- Don't break existing list rendering for non-checkbox list items
- `[ ]` / `[x]` in artifacts renders as checkboxes in view mode, shows as raw text in edit mode (correct - user is editing markdown)
- Action item cards should visually feel like an upgraded version of the existing `ActionItemCard`, not a totally different component. Same border, same sizing, same text scale - just with a checkbox added.

## Relationship to `InlineActionButtons`

The existing `InlineActionButtons` component (`src/components/inline-action-buttons.tsx`) renders surfaced action items with Done/Skip/Later buttons. The new `ActionItemCheckbox` in the `ActionItemCard` is a different interaction point:
- `InlineActionButtons` = proactive surfacing of items that need attention (nudges, surfaced items)
- `ActionItemCard` with checkbox = inline confirmation of items just created in that message

These are complementary, not redundant. Don't remove `InlineActionButtons`. However, reuse patterns from it (the Supabase browser client call, the optimistic state pattern, the animation).

## Build Order

1. Part 1 first (artifact checkboxes) - no new tables, pure frontend. Test by creating a checklist artifact and toggling items.
2. Part 2 second (action item cards with checkboxes) - modify existing component + new checkbox component + prompt changes. Test by asking Crosby to create action items and verifying the cards render with working checkboxes.

## Testing

**Part 1:**
- Create an artifact with `type: 'checklist'` containing `[ ]` items
- Verify checkboxes render in view mode
- Click a checkbox, verify it toggles to `[x]` and the text gets strikethrough
- Switch to edit mode, verify the raw content shows `[x]`
- Switch back to view mode, verify it still shows checked
- Reload the page, verify the checked state persisted (auto-save)

**Part 2:**
- Send a message like "I need to follow up with Roger about labor and send Jenny the updated SOP"
- Verify Crosby calls `manage_action_items` to create both items
- Verify the items render as cards with checkboxes (not as text bullets)
- Click a checkbox, verify the action item status updates to `completed` in the DB
- Uncheck it, verify it goes back to `pending`
- Navigate away and come back, verify the checked state is correct (reads from `action_items` table)
