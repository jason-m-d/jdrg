# Crosby Project Instructions

## Dev Server
- Claude is responsible for starting, stopping, and restarting the dev server as needed.
- The dev server runs on port 3010: `npm run dev` (which runs `next dev -p 3010`)
- If the server is unresponsive or crashed, kill it and restart it. Don't ask the user to do this.
- Never assume the server is already running. Check first, and start/restart as needed.

## Database
- Supabase is the database. The Supabase MCP server is configured in `.mcp.json` for direct database access.
- Use the Supabase MCP tools to run migrations, query data, and manage schema. Don't ask the user to go to the Supabase dashboard.
- Migration SQL files live in `scripts/`. When creating new tables or schema changes, write the SQL there and run it via the MCP server.

## Stack
- Next.js (App Router), TypeScript, Tailwind CSS
- Supabase (Postgres + auth + storage)
- Anthropic Claude API for the AI chat (routed through OpenRouter via ANTHROPIC_BASE_URL)
- OpenAI text-embedding-3-small via OpenRouter for embeddings (RAG) — see `src/lib/embeddings.ts`

## AI Routing (OpenRouter)
All AI calls go through OpenRouter (`ANTHROPIC_BASE_URL`). Do not call Anthropic directly.

- **Main chat:** `anthropic/claude-sonnet-4.6:exacto` (`:exacto` suffix = prefer providers with better tool-calling accuracy). Fallback array: `["anthropic/claude-sonnet-4.6:exacto", "google/gemini-3.1-pro-preview"]`. Provider sort: `latency`.
- **Background jobs** (email scan, morning briefing, session greeting, memory extraction, session summarization, notepad extraction, training rules): `google/gemini-3.1-flash-lite-preview`. Fallback: `google/gemini-3-flash-preview`. Provider sort: `price`.
- **Web search:** `perplexity/sonar-pro-search` via a separate client call inside `executeWebSearch()`. Provider sort: `price`.
- **PDF OCR fallback:** `google/gemini-2.0-flash-001` via Anthropic document block format.
- Pass fallbacks via `extra_body: { models: [...], provider: { sort: "..." } }` — NOT via `X-OR-Models` header (that's undocumented and was removed).
- For structured JSON output in background jobs, use `response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: {...} } }` plus `plugins: [{ id: 'response-healing' }]` in `extra_body`. The response-healing plugin fixes malformed JSON from models.
- System prompt uses `cache_control: { type: "ephemeral" }` on the main chat stream to reduce token cost on the 10-20KB prompt.
- **Duplicate tool names → 400 error:** If a tool appears more than once in the tools array sent to the API, Claude rejects the request with a 400 "tool names must be unique" error. This manifests as "I ran into a connection issue" for the user. Root cause was `request_additional_context` listed in `core.ts` tools AND appended separately in the chat route (fixed 2026-03-19, commit 5e5f82c). Always check for duplicates when adding tools to a specialist or the chat route.
- **Error responses must not be saved as conversation history:** When a connection error occurs and Crosby sends "I ran into a connection issue", that error text must NOT be inserted into the `messages` table. If it is, it loads as history on the next request and confuses the model. Use an `isErrorResponse` flag to skip the DB insert on error paths (`src/app/api/chat/route.ts`).

## Adding New AI Calls
- All new AI calls MUST go through OpenRouter (`ANTHROPIC_BASE_URL`). Never call a provider directly.
- For new background jobs/crons: use `google/gemini-3.1-flash-lite-preview` with `provider: { sort: 'price' }` and fallback to `google/gemini-3-flash-preview`.
- For complex multi-step research or agentic tasks: use `anthropic/claude-sonnet-4.6:exacto` with `provider: { sort: 'latency' }`.
- If the call expects JSON output: always use `response_format` with `json_schema` plus the `response-healing` plugin in `extra_body`.
- If the call sends the same system prompt repeatedly (batch processing): wrap system in `cache_control: { type: 'ephemeral' }`.
- Always pass fallbacks via `extra_body: { models: [...] }`.

## Vercel Deployment
- Project: `crosby` (project ID: `prj_AAEU52WPmlVsCxoOjSCwWeIer6B3`, team: `team_1ScBOG4NfpAoS3j3kfeEmFDc`)
- Cron jobs are defined in `vercel.json`. All times are UTC.
- Vercel MCP tools are available for deployments, build logs, and runtime logs.

### Getting Full Logs (Vercel MCP tools truncate)
The Vercel MCP tools often return truncated logs. When you need the full picture, use these workarounds:

**Build logs (deploy failures):**
1. First try the MCP tool `get_deployment_build_logs` for the deployment ID
2. If truncated, use the Vercel CLI: `npx vercel logs <deployment-url> --output=raw 2>&1 | tail -100`
3. Or fetch directly via API: `curl -s -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v7/deployments/<deployment-id>/events" | jq '.[-20:]'`

**Runtime logs (500 errors, cron failures, API errors):**
1. First try the MCP tool `get_runtime_logs`
2. If truncated, use: `npx vercel logs <deployment-url> --output=raw --follow 2>&1 | head -200`
3. For cron-specific failures, also check the background_jobs table in Supabase - cron routes log errors there

**Function timeout debugging:**
- Vercel Hobby plan: 60s function timeout. Pro plan: 300s.
- If a cron job or API route times out, check if it's doing too many sequential DB queries or AI calls
- The chat route has a 30-second internal abort timeout for the AI stream, separate from Vercel's function timeout

**Common Vercel-specific issues:**
- `FUNCTION_INVOCATION_TIMEOUT` - function exceeded time limit. Check which API route and whether it's waiting on an external call (OpenRouter, Supabase, Google Calendar)
- `EDGE_FUNCTION_INVOCATION_FAILED` - usually a missing env var or import error
- Build failures after dependency changes - clear `.next` cache: `rm -rf .next && npm run build`
- Cron jobs returning non-200 - Vercel marks them as failed. Check the route's error handling.

### Environment Variable Management
Env vars with trailing newlines, blank lines, or whitespace will silently break API URLs and keys. When debugging connection issues, ALWAYS check env vars first.

**Inspect env vars:**
```bash
# Pull current Vercel env vars to a local file for inspection
npx vercel env pull .env.vercel-check

# Compare against local .env.local to spot mismatches
diff .env.local .env.vercel-check

# Check for whitespace/newline issues in a specific var
npx vercel env pull /dev/stdout 2>/dev/null | grep -A1 "ANTHROPIC_BASE_URL"
```

**Fix a broken env var:**
```bash
# Remove the bad value
npx vercel env rm VAR_NAME production
npx vercel env rm VAR_NAME preview
npx vercel env rm VAR_NAME development

# Re-add with clean value (echo -n strips trailing newline)
echo -n "clean-value-here" | npx vercel env add VAR_NAME production
echo -n "clean-value-here" | npx vercel env add VAR_NAME preview
echo -n "clean-value-here" | npx vercel env add VAR_NAME development
```

**After fixing env vars, redeploy:**
```bash
npx vercel --prod
```

**Sync check after deploys:** When a deploy fails with connection errors or "module not found" on API routes, run `npx vercel env pull .env.vercel-check` and diff against `.env.local` before debugging code. Env var issues masquerade as code bugs.

## Document Pipeline
- Uploads go through `/api/documents/upload` — same endpoint for both the Documents page and the chat paperclip attachment.
- PDF text extraction uses `unpdf` (`src/lib/pdf.ts`). If extracted text < 100 chars, falls back to `ocrPdfWithAI()` which sends the PDF bytes to Gemini via Anthropic document block format.
- Chunking + embedding (OpenAI text-embedding-3-small via OpenRouter) runs in the background after every upload.
- Files attached via the paperclip are uploaded immediately on selection, before the user hits send.

## Outstanding Issues & Tech Debt
A living issue tracker lives at `OUTSTANDING-ISSUES.md` in the project root. Use it.

**At the start of every work session:** Skim the Active Issues list. If you're about to work on something related to an open issue, fix it while you're in there.

**When you find a non-blocking issue:** Log it in `OUTSTANDING-ISSUES.md` under Active Issues with severity, date, description, suggested fix, and risk level. Don't lose track of it.

**When you fix an issue:** Move it to the Resolved section with the date and what you did.

**When Jason asks "what needs fixing" or "what's on the list":** Read and summarize `OUTSTANDING-ISSUES.md`.

## Prompt Engineering Backlog
A prioritized list of prompt and UX improvements lives at `CROSBY-PROMPTS.md` in the project root. When Jason says "work on the prompts" or "next prompt task", read that file and work through items in order. When you complete a task, mark it done in the file. When Jason gives new feedback on cron messages, proactive messages, or response quality, add it to the appropriate section in that file.

## Self-Healing: Document What You Learn
When you hit a problem and figure out the fix (or Jason tells you the fix), you MUST document it so the same mistake never happens twice. This is not optional.

**What to document and where:**
- **Env var gotchas, deploy issues, CLI workarounds, infra quirks** - Add to the relevant section in this CLAUDE.md file (e.g., Vercel Deployment, AI Routing, etc.)
- **OpenRouter API patterns, model changes, provider bugs** - Add to `.claude/commands/openrouter-expert/SKILL.md` or its `references/` folder
- **Eval methodology changes** - Add to `.claude/commands/crosby-eval.md`
- **New patterns or conventions that affect how code should be written** - Add to the relevant section in this CLAUDE.md file

**When to document:**
- You tried something that didn't work and had to find the right approach
- Jason corrected you or told you the fix
- You discovered a quirk in a third-party API or service (OpenRouter, Vercel, Supabase, Google Calendar, etc.)
- A debugging session revealed a non-obvious root cause (e.g., env var whitespace, header bugs, wrong SDK client)
- You find yourself about to do something you've already been corrected on before

**Format:** Keep it concise. One bullet or a short paragraph. Include the symptom, the root cause, and the fix. Don't write essays.

**Example:**
```
- `ANTHROPIC_BASE_URL` must be `https://openrouter.ai/api/v1` (with /v1). Without the /v1 suffix, the Anthropic SDK constructs the wrong endpoint URL and all chat requests fail with "connection issue."
```

## Verification Rule
- If you instruct the user to do something within the app (click a button, use a feature, navigate somewhere, etc.), you must first verify that the thing actually exists and is rendering in the UI. If it's not there, flag it immediately so we can build it out. Don't send the user on a hunt for something that doesn't exist yet.

## App Manual (Living Document)
- The Crosby App Manual is a RAG document that makes the in-app bot an expert on every feature. It lives in `scripts/seed-app-manual.ts` and gets chunked/embedded for vector search.
- **When you add a meaningful feature, change how a feature works, or add a new tool/background process**, update the app manual content in `seed-app-manual.ts` to reflect the change. Then re-seed it by running `npx tsx scripts/seed-app-manual.ts`.
- The manual covers: all tools, background processes, feature connections, proactive behavior guidelines, and how the app layout works. Keep it accurate.
- Small UI tweaks and copy changes don't need a manual update — only changes that affect what the bot can do or how features work.

## Architecture Refactor Plan
- The full architecture refactor plan lives in `CROSBY-ARCHITECTURE-REFACTOR.md` in the project root. Reference it for context on the router, specialist system, typing prediction, and overall direction.
- The refactor is phased: Phase 0 (stability guards) -> Phase 1 (AI router replacing regex classifier) -> Phase 2 (typing prediction + specialist chips + inline autocomplete) -> Phase 3 (route decomposition) -> Phase 4 (specialist system) -> Phase 5 (QA).
- **Key architectural concepts:**
  - **Router:** A fast Gemini Flash Lite call that replaces the regex-based `classifyIntent()` in `src/lib/intent-classifier.ts`. It determines what data to load, what tools to activate, and what projects are relevant. Lives in `src/lib/router.ts`.
  - **Specialists:** Self-contained modules (email, calendar, sales, tasks, documents, texts, core) that each have their own prompt section, tools, and data requirements. The router activates only the specialists needed for each message. Defined with declarative `triggerRules` (JSON-serializable, not functions) so they can eventually be stored in a database for user-created specialists.
  - **Prefetch:** A `/api/chat/prefetch` endpoint called while the user types. Returns specialist classifications (shown as chips above the input) and inline autocomplete suggestions. Results are cached server-side so the real chat request can skip the router call.
  - **Tool executor registry:** A `Map<string, ExecutorFunction>` in `src/lib/chat/tools/registry.ts` that replaces the if/else tool dispatch chain. Groundwork for future dynamic tool registration.
  - **`request_additional_context` tool:** A self-correction mechanism - if the router misclassifies and the model needs data that wasn't loaded, it can call this tool to fetch additional data blocks mid-response.
- **When making changes during the refactor:** always keep the old `classifyIntent()` as a fallback. The router has a 3-second timeout and falls back to regex classification if it fails.
- **Terminology:** "Conversation" = the one long-running chat. "Session" = a chapter within it (auto-closes after 30 messages or 2hr idle). Don't use "new conversation" when you mean "new session."

## Crosby Eval Skill (QA Co-Pilot)
- The eval skill lives at `.claude/commands/crosby-eval/SKILL.md`. It's what Jason uses with Claude Code to QA Crosby's responses.
- The skill is designed to dynamically discover the current app state (tables, tools, prompt rules, crons) at the start of each eval session, so it stays current without manual updates for most changes.
- **However, if you make a structural change that affects how eval should work** - like changing how tool calls are stored in messages, adding a new evaluation dimension, changing the background job execution flow, or restructuring the system prompt format - update the eval skill to reflect that change.
- The eval skill does NOT need updates for: new tables, new tools, new cron jobs, prompt wording changes, or new features. It discovers those dynamically.
- It DOES need updates for: changes to message format/storage, changes to how tool calls are embedded in content, new workflow modes, or architectural changes to the chat pipeline.
