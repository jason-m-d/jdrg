# Multi-Tenant Production Plan

**Created:** March 17, 2026
**Status:** Planning — not yet implementing

---

## The Core Idea

Turn Crosby from a single-user app hardcoded for Jason DeMayo into a multi-user platform where AI-powered onboarding replaces all the hardcoded context. The onboarding conversation IS the product demo — the app proves its value while setting itself up.

---

## Current State (Audit Summary)

**Everything is hardcoded for one user:**
- System prompt contains Jason's full name, businesses, 10 store numbers, 7 key contacts, 3 email addresses, ownership percentages
- Every tool description references "Jason" by name
- Email scanning has hardcoded Wingstop/Mr. Pickle's parsers and store numbers
- Briefing builder has hardcoded sales targets ($8k Wingstop, $3k MP)
- UI branded as "Crosby — DeMayo Restaurant Group"
- Settings pages have hardcoded store toggle lists

**No user isolation in the database:**
- Zero tables have a `user_id` column
- RLS policies are all `USING (true)` — any authenticated user sees everything
- Gmail tokens keyed by email address, not user
- All queries use `supabaseAdmin` with no user filtering
- Training data, memories, preferences — all global

**What IS multi-user ready:**
- Supabase auth (login/session works)
- Auth provider and session hooks
- Basic page structure and routing

---

## Phase 1: Database Foundation

**Goal:** Every piece of data belongs to a user. No data leaks between users.

### New tables

```sql
-- The replacement for the hardcoded BASE_SYSTEM_PROMPT
CREATE TABLE user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  display_name text,
  role text,                    -- "CEO", "Operations Manager", etc.
  industry text,                -- "restaurants", "agency", "startup", etc.
  business_context jsonb,       -- Flexible: stores, clients, team, whatever fits
  contacts jsonb,               -- Key people the AI should know about
  email_addresses text[],       -- User's known email addresses
  workspace_name text,          -- What they want to call their workspace
  onboarding_completed boolean DEFAULT false,
  onboarding_step text,         -- Track where they are if they leave mid-onboarding
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Track connected services per user
CREATE TABLE user_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider text NOT NULL,       -- 'gmail', 'outlook', 'slack', etc.
  account_identifier text,      -- email address or username
  config jsonb,                 -- Provider-specific config
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, provider, account_identifier)
);
```

### Modified tables (add user_id)

Every existing table gets:
```sql
ALTER TABLE [table] ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
```

Tables to modify:
- projects
- documents
- document_versions
- document_chunks
- conversations
- messages
- memories
- action_items
- email_scans
- sales_data
- google_tokens (add user_id alongside existing account key)
- artifacts
- artifact_versions
- project_context
- context_chunks
- user_state
- ui_preferences
- dashboard_cards
- notification_rules
- bookmarks
- training_examples
- training_rules

### RLS policy updates

Replace every `USING (true)` with:
```sql
CREATE POLICY "User isolation" ON [table]
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### Migration strategy for existing data

1. Create `user_profiles` table, populate Jason's from current hardcoded values
2. Add `user_id` to all tables with `DEFAULT NULL` temporarily
3. Backfill all rows with Jason's user ID
4. Set `user_id` to `NOT NULL`
5. Update RLS policies
6. Update vector search RPC functions (`match_documents`, `match_context`, `match_training_examples`) to accept and filter by `user_id`

---

## Phase 2: API Layer — User Scoping

**Goal:** Every API endpoint knows who's asking and only returns their data.

### Auth extraction pattern

Create a helper (or update existing `requireAuth`):
```typescript
async function getAuthenticatedUser(req: NextRequest) {
  // Extract user from Supabase session
  // Return user_id or throw 401
}
```

### Every API route gets updated:

- `GET /api/projects` → filter by user_id
- `GET /api/documents` → filter by user_id
- `GET /api/action-items` → filter by user_id
- `GET /api/conversations` → filter by user_id
- `GET /api/artifacts` → filter by user_id
- `GET /api/user-state` → filter by user_id
- `GET /api/preferences` → filter by user_id
- `POST /api/chat` → scope all tool calls and queries to user_id
- All write endpoints → attach user_id to new rows

### Gmail integration changes

- `google_tokens` gets `user_id` column
- OAuth callback links token to authenticated user, not just email
- `searchEmails()` takes user_id, finds that user's connected account
- Email scan cron iterates by user, not by global account list

---

## Phase 3: Dynamic System Prompt

**Goal:** Replace every hardcoded reference to Jason with database-driven context.

### What `buildSystemPrompt()` becomes:

```
1. Load user_profile for current user
2. Build identity section from profile (name, role, business context)
3. Build contacts section from profile.contacts
4. Load user's memories
5. Load user's active projects with system prompts
6. Load user's recent action items
7. Load relevant document chunks (scoped to user)
8. Assemble final prompt
```

### Tool descriptions become generic:

- "Create action items for Jason" → "Create action items for the user"
- "Search Jason's Gmail" → "Search the user's connected email"
- "Jason's projects" → "the user's projects"

### Email scanning prompt becomes dynamic:

Instead of hardcoded "Jason DeMayo, CEO of DeMayo Restaurant Group":
- Load user profile
- Build extraction prompt from their business context
- If they have stores → include store-aware parsing
- If they don't → use generic email-to-action-item extraction

### Briefing builder becomes dynamic:

- Sales targets come from `user_profiles.business_context` instead of hardcoded `$8000`
- Store lists come from profile instead of hardcoded arrays
- Greeting references user's name from profile

---

## Phase 4: The Onboarding Experience

**Goal:** New users go through a conversation that builds their profile, connects their tools, and demonstrates value — all before they see the main app.

### Flow

```
Sign up → /onboarding → Conversation → Profile built → Redirect to /dashboard
```

### Route: `/onboarding`

- Clean, focused chat interface — no sidebar, no navigation
- Dedicated onboarding system prompt
- Progress indicator (subtle — not a step wizard, just awareness)
- "Skip for now" option at any point

### The Conversation Structure

**Phase A: Identity (30 seconds)**

AI asks what the user does. From the answer, extracts:
- Name, title/role, industry
- Type of work (franchise, agency, startup, solo, etc.)

AI reflects back its understanding. First "prove it" moment.

**Phase B: Business Context (1-2 minutes)**

Based on role/industry, AI asks targeted follow-ups:
- Franchise operator → "How many locations? What brands?"
- Agency → "How many clients? Organized by client or project?"
- Startup → "What stage? Team size?"
- Solo professional → "What kind of work? Recurring clients?"

Each answer writes to `user_profiles.business_context`.

**Phase C: Key People (30 seconds)**

"Who are the people you work with most? Names and roles are enough — I'll learn their emails as I see them."

Writes to `user_profiles.contacts`.

**Phase D: Connect Email (1 minute)**

"Want me to connect to your email? I'll scan recent messages and show you what I find."

If yes → OAuth flow → immediate scan → show extracted action items.

**This is the big "prove it" moment.** Real action items from real emails, surfaced before the user has done anything.

If no → skip, offer later.

**Phase E: Workspace Setup (15 seconds)**

"What do you want to call your workspace?" (defaults to their name or company)

Sets branding, completes onboarding, redirects to dashboard.

### Onboarding system prompt

A dedicated prompt that:
- Guides the conversation through phases A-E
- Uses tool calls to write to user_profiles at each step
- Knows what information it still needs
- Can handle users who give too little or too much info
- Stays conversational, not interrogative

### What the AI writes during onboarding

Each phase produces structured data via tool calls:
- `update_profile({ name, role, industry })`
- `update_business_context({ type: "franchise", brands: [...], locations: [...] })`
- `update_contacts([{ name, role, email? }])`
- `connect_integration("gmail")`
- `set_workspace_name("...")`
- `complete_onboarding()`

---

## Phase 5: UI Generalization

**Goal:** Remove all Jason/DRG-specific branding and make UI adapt to user context.

### Branding changes

- Page title: workspace_name or generic "AI Workspace"
- Login page: generic, no "DeMayo Restaurant Group"
- Sidebar logo: workspace_name or generic
- Placeholder email on login: generic "you@company.com"

### Settings pages

- Briefing settings: store toggles generated from `user_profiles.business_context` instead of hardcoded
- If user has no stores → don't show store toggles
- Memory/email/account settings already mostly generic

### Signup page (new)

- Currently only login exists
- Add registration with email/password
- After signup → redirect to /onboarding

---

## Phase 6: Adaptive Intelligence

**Goal:** The AI learns and adapts to each user over time, not just during onboarding.

### Email pattern learning

Instead of hardcoded Wingstop/MP parsers:
- AI identifies recurring email patterns per user
- "I notice you get daily reports from sales@brand.com — want me to extract numbers from these?"
- User confirms → creates a per-user extraction rule
- Uses training_examples (now user-scoped) to improve over time

### Progressive feature introduction

Features surface as they become relevant:
- User gets lots of emails about deadlines → "Want me to auto-create action items with due dates from these?"
- User creates several documents → "Want me to create a project to organize these?"
- User mentions team members → "Want me to watch for emails from them?"

### Profile evolution

The onboarding conversation isn't the only time the AI learns. In normal chat:
- User mentions a new contact → offer to add to contacts
- User talks about a new store/client/project → offer to update business context
- User corrects the AI → update profile/training

---

## Implementation Order

If/when we decide to build this:

1. **Phase 1** (Database) — Do first. Everything depends on user scoping.
2. **Phase 2** (API layer) — Immediately after. Makes the app safe for multiple users.
3. **Phase 3** (Dynamic prompts) — Core value. Makes the AI work for anyone.
4. **Phase 5** (UI) — Quick wins. Remove hardcoded branding.
5. **Phase 4** (Onboarding) — The flagship feature. Build after the foundation exists.
6. **Phase 6** (Adaptive) — Ongoing. Layer this in over time.

### Migration for existing data

Jason's data stays intact throughout:
- Phase 1 backfills his user_id on all existing rows
- Phase 3 moves his hardcoded profile into user_profiles
- His experience doesn't change — everyone else gets onboarding

---

## Open Questions

### Business model
- Free tier? Usage-based? Subscription?
- Who pays for API costs (Anthropic, Voyage AI)?
- Do users bring their own API keys?

### Google OAuth
- Currently running unverified for personal use
- Multi-user requires Google's OAuth verification process
- This is a weeks-long review process with security requirements

### Data privacy
- Storing other people's email content and business data
- Need privacy policy, terms of service
- Data residency / encryption considerations
- GDPR if any EU users

### Scaling
- One Supabase instance? Multi-tenant with shared DB?
- Rate limiting per user for API calls
- Background job queue for email scanning (currently cron-based)

### Identity
- What's the product called? "Crosby" is personal. Need a product name.
- Domain, branding, marketing site

---

## What Makes This Special

The key differentiator isn't "AI workspace" — lots of those exist. It's:

1. **Onboarding IS the demo.** The user sees real value from their real data before they've configured anything.
2. **The system prompt writes itself.** The AI builds its own context through conversation, not forms.
3. **It adapts to any industry.** A restaurant franchisee and a startup founder get fundamentally different experiences from the same infrastructure.
4. **Intelligence compounds.** The training system means the AI gets better at knowing what matters to each specific user over time.

The current app already proves this works for one user. The question is whether the onboarding can replicate that quality of context for anyone.
