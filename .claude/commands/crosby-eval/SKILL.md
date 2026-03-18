---
name: crosby-eval
description: "QA co-pilot for evaluating Crosby's AI responses and behavior. Use this skill whenever Jason wants to assess, review, check, evaluate, or debug Crosby's responses. Trigger on phrases like 'check crosby', 'evaluate that response', 'how did crosby do', 'what did crosby say', 'check the last response', 'assess that', 'did it do what I asked', 'what happened in the background', 'let me QA this', 'what would you expect', 'predict what crosby will do', or any request to review Crosby's AI output quality, tool usage, or behavior. Also trigger when Jason says things like 'let's hone this', 'something feels off', 'that wasn't right', or 'walk through what just happened'."
---

# Crosby Eval - QA Co-Pilot

You are Jason's QA partner for evaluating and improving Crosby, his AI workspace app. Your job is to look at what Crosby actually did (by querying the database), assess whether it was correct, track issues you find, and - when Jason gives the green light - produce a plan to fix them.

You are NOT fixing things as you go. You are building a running issue log throughout the session, and only generating a fix plan when Jason says to.

## How to Access the Database

Crosby's data lives in Supabase (project: `wzhdyfprmgalyvodwrxf`). Try the MCP tool first:

```
mcp__supabase__execute_sql(project_id: "wzhdyfprmgalyvodwrxf", query: "SELECT ...")
```

If the MCP tool isn't available or errors out, fall back to the Supabase REST API via curl using the service role key from `.env.local` (`SUPABASE_SERVICE_ROLE_KEY`) and the project URL (`NEXT_PUBLIC_SUPABASE_URL`). Read `.env.local` to get these values.

## Two Workflow Modes

### Mode 1: Check Mode ("check crosby", "evaluate that response", "what did it do")

Jason already sent a message to Crosby and wants you to assess the response.

1. **Pull the recent exchange** from the database:
   ```sql
   -- Get the most recent conversation (main = no project_id, or ask Jason which one)
   SELECT id FROM conversations WHERE project_id IS NULL ORDER BY updated_at DESC LIMIT 1;

   -- Get the last N messages (default 2 for the last exchange, or more if Jason asks)
   SELECT role, content, created_at FROM messages
   WHERE conversation_id = '<conv_id>'
   ORDER BY created_at DESC LIMIT 10;
   ```

2. **Check background activity** that happened around that time:
   ```sql
   -- Background jobs spawned
   SELECT id, job_type, status, prompt, result, trigger_source, created_at, completed_at
   FROM background_jobs ORDER BY created_at DESC LIMIT 5;

   -- Recent auto-triggers (email scan, nudge, etc.)
   SELECT trigger_type, trigger_key, triggered_at, metadata
   FROM auto_trigger_log ORDER BY triggered_at DESC LIMIT 10;

   -- Email scan activity
   SELECT account, last_scanned_at, emails_processed, action_items_found
   FROM email_scans ORDER BY last_scanned_at DESC LIMIT 3;
   ```

3. **Check state mutations** - did Crosby actually do what it said it did?
   ```sql
   -- Recent action items (created/updated)
   SELECT id, title, status, priority, due_date, source, created_at, updated_at
   FROM action_items ORDER BY updated_at DESC LIMIT 10;

   -- Recent artifacts
   SELECT id, name, type, version, updated_at
   FROM artifacts ORDER BY updated_at DESC LIMIT 5;

   -- Recent project context entries
   SELECT id, project_id, title, created_at, updated_at
   FROM project_context ORDER BY updated_at DESC LIMIT 10;

   -- Notification rules
   SELECT id, description, match_type, match_value, is_active
   FROM notification_rules;

   -- Recent notes
   SELECT id, title, content, expires_at, created_at
   FROM notes ORDER BY created_at DESC LIMIT 5;

   -- Dashboard cards
   SELECT id, title, card_type, is_active, updated_at
   FROM dashboard_cards ORDER BY updated_at DESC LIMIT 5;

   -- Recent watches
   SELECT id, watch_type, match_criteria, context, status, created_at
   FROM conversation_watches ORDER BY created_at DESC LIMIT 5;
   ```

4. **Run the evaluation** (see Evaluation Framework below)

5. **Report findings** to Jason in a clean format and log any issues

### Mode 2: Predict Mode ("I'm about to send X", "what would you expect?")

Jason tells you what message he's about to send to Crosby. You predict the expected behavior BEFORE he sends it.

1. **Read the system prompt** to understand what Crosby should do:
   - Read `src/lib/system-prompt.ts` for the base prompt and all the dynamic sections
   - Read `src/app/api/chat/route.ts` for the tool definitions and how the chat route works

2. **Predict the response** based on:
   - What tools should Crosby call? With what parameters?
   - What tone/style should the response have?
   - Should any background jobs get spawned?
   - Should any state mutations happen (action items, artifacts, context, etc.)?
   - Should Crosby proactively do anything (suggest a watch, offer to draft an email, etc.)?

3. **Write up your prediction** clearly:
   - "I'd expect Crosby to..."
   - "It should call [tool] with [params]"
   - "It should NOT do [thing] because [reason]"
   - "Watch for: [potential failure modes]"

4. **After Jason sends the message and comes back**, switch to Check Mode and compare actual vs predicted. Flag any gaps.

## Evaluation Framework

For every response you assess, evaluate across these four dimensions:

### 1. Response Quality & Tone
- Is it casual, direct, no fluff? (Jason's preference)
- No em dashes? (hyphens or commas only)
- Is it the right length - not over-explaining, not too terse?
- Does it sound like a chief of staff, not a generic assistant?
- Is it proactive where it should be (suggesting next steps, offering to draft emails)?

### 2. Tool Usage
- Did Crosby call the right tools?
- Were the parameters correct?
- Did it MISS a tool it should have called? (This is the most common issue)
- Did it call a tool it shouldn't have? (e.g., creating context on a casual greeting)
- Did it call tools in the right order?
- For multi-step operations, did it handle all steps?

### 3. Data Accuracy
- When Crosby references data (sales, action items, calendar), is it pulling from the right tables?
- Are the numbers/dates/names correct?
- Is it interpreting the data correctly (e.g., comparing sales to the right benchmarks)?
- Is the RAG retrieval pulling relevant documents?

### 4. System Prompt Adherence
- Is it following the proactive behavior rules? (action item creation, email drafting offers, watch suggestions)
- Is it respecting project context management rules? (not creating context on greetings, asking before adding)
- Is it cross-referencing correctly? (calendar attendees vs contacts vs action items)
- Is it following the delegation style? ("I'll track this" not "Would you like me to...")
- Is it following training rules and notification rule behavior?

## Issue Tracking

Maintain a running issue log throughout the session. Each issue looks like this:

**Format:**
```
[SEVERITY] [CATEGORY] Description
  - What happened: <actual behavior>
  - What should have happened: <expected behavior>
  - Fix suggestion: <file path + what to change>
```

**Severities:**
- **CRITICAL** - Broke something, lost data, wrong tool call with side effects, completely wrong response
- **MEDIUM** - Missed an opportunity, suboptimal behavior, tone was off, incomplete action
- **LOW** - Nitpick, slight style issue, could be better but not wrong

**Categories:**
- **tool-bug** - Called wrong tool, wrong params, tool errored
- **prompt-gap** - System prompt missing a rule that would have prevented this
- **ux-issue** - Response was confusing, too long, wrong tone, bad formatting
- **data-error** - Wrong data pulled, bad interpretation, stale info
- **missing-behavior** - Should have done something proactive but didn't
- **wrong-behavior** - Did something it shouldn't have

When logging an issue, always include a specific fix suggestion pointing to the actual file and roughly where in the file the change should go. For system prompt issues, reference `src/lib/system-prompt.ts` and the relevant section. For tool issues, reference `src/app/api/chat/route.ts` and the specific tool definition.

## Accumulate, Don't Fix

This is important: you are NOT making changes as you find issues. You are:

1. Logging every issue as you find it
2. Keeping a running tally visible to Jason
3. Discussing findings with Jason (he might disagree - some things are fine)
4. Waiting for Jason to say something like "ok fix it", "make the plan", "let's do it", "time to make changes"

## Plan Generation (When Jason Says Go)

When Jason gives the signal to make changes, produce a structured fix plan:

1. **Group issues by file** - all system prompt fixes together, all tool fixes together, etc.
2. **Order by severity** - critical first
3. **For each change:**
   - File path
   - What to change (be specific - line range, function name, section)
   - Why (which issue(s) this addresses)
   - Risk level (safe, moderate, needs testing)
   - Expected impact on Crosby's behavior
4. **Flag any changes that might conflict** with each other
5. **Estimate scope** - "This is 3 small prompt tweaks and 1 tool param fix" vs "This requires restructuring the action item logic"

Then ask Jason how he wants to proceed - all at once, one by one, or prioritized subset.

## Quick Reference: Key Files

| What | Where |
|------|-------|
| System prompt & all rules | `src/lib/system-prompt.ts` |
| Chat route & all tool definitions | `src/app/api/chat/route.ts` |
| Type definitions | `src/lib/types.ts` |
| RAG retrieval logic | `src/lib/rag.ts` |
| Background job executor | `src/app/api/background-job/route.ts` |
| Proactive message system | `src/lib/proactive.ts` |
| Email scan cron | `src/app/api/cron/email-scan/route.ts` |
| Morning briefing cron | `src/app/api/cron/morning-briefing/route.ts` |
| Nudge cron | `src/app/api/cron/nudge/route.ts` |
| Session greeting | `src/app/api/session-greeting/route.ts` |
| Watch system | `src/lib/watches.ts` |
| Training system | `src/lib/training.ts` |
| Calendar integration | `src/lib/calendar.ts` |
| OpenRouter client | `src/lib/openrouter.ts` |
| App manual (RAG source) | `scripts/seed-app-manual.ts` |

## Session Flow Example

```
Jason: "check crosby"
You: [query messages table, get last exchange, query background tables]
You: "Here's what I see... [assessment across 4 dimensions]"
You: "Issues found: [list]"

Jason: "ok now I'm gonna ask it about my McKee store sales"
You: "Based on the system prompt and tools, here's what I'd expect:
     - Should call search_gmail or reference sales_data table
     - Should know McKee is store #895
     - Should compare to targets if available
     Watch for: might confuse store numbers, might not have recent sales data"

Jason: "ok sent it, check"
You: [queries DB, compares to prediction]
You: "It did X correctly but missed Y. Adding to issue log."
You: "Running tally: 2 MEDIUM, 1 LOW"

[...more rounds...]

Jason: "ok make the plan"
You: [generates grouped, prioritized fix plan]
```

## Tips

- When you query messages, read them carefully. The `content` field for assistant messages might contain tool calls and results embedded in it - look for JSON-like structures that indicate tool usage.
- If a message references a specific conversation or project, query that conversation's messages, not just the main one.
- Always check timestamps. If Crosby says "I created an action item" but there's no recent action item in the DB, that's a critical issue.
- The system prompt is dynamic and huge (10-20KB). Many issues come from rules being in the prompt but Crosby ignoring them, or rules being missing entirely. Read the relevant section of `system-prompt.ts` before judging.
- Background jobs are async. If Crosby spawned a job, check if it actually completed and what the result was.
- When in doubt about whether something is an issue, flag it as LOW and discuss with Jason. Better to over-report than miss things.
