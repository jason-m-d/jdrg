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

## Adding New AI Calls
- All new AI calls MUST go through OpenRouter (`ANTHROPIC_BASE_URL`). Never call a provider directly.
- For new background jobs/crons: use `google/gemini-3.1-flash-lite-preview` with `provider: { sort: 'price' }` and fallback to `google/gemini-3-flash-preview`.
- For complex multi-step research or agentic tasks: use `anthropic/claude-sonnet-4.6:exacto` with `provider: { sort: 'latency' }`.
- If the call expects JSON output: always use `response_format` with `json_schema` plus the `response-healing` plugin in `extra_body`.
- If the call sends the same system prompt repeatedly (batch processing): wrap system in `cache_control: { type: 'ephemeral' }`.
- Always pass fallbacks via `extra_body: { models: [...] }`.

## Document Pipeline
- Uploads go through `/api/documents/upload` — same endpoint for both the Documents page and the chat paperclip attachment.
- PDF text extraction uses `unpdf` (`src/lib/pdf.ts`). If extracted text < 100 chars, falls back to `ocrPdfWithAI()` which sends the PDF bytes to Gemini via Anthropic document block format.
- Chunking + embedding (OpenAI text-embedding-3-small via OpenRouter) runs in the background after every upload.
- Files attached via the paperclip are uploaded immediately on selection, before the user hits send.

## Verification Rule
- If you instruct the user to do something within the app (click a button, use a feature, navigate somewhere, etc.), you must first verify that the thing actually exists and is rendering in the UI. If it's not there, flag it immediately so we can build it out. Don't send the user on a hunt for something that doesn't exist yet.

## App Manual (Living Document)
- The Crosby App Manual is a RAG document that makes the in-app bot an expert on every feature. It lives in `scripts/seed-app-manual.ts` and gets chunked/embedded for vector search.
- **When you add a meaningful feature, change how a feature works, or add a new tool/background process**, update the app manual content in `seed-app-manual.ts` to reflect the change. Then re-seed it by running `npx tsx scripts/seed-app-manual.ts`.
- The manual covers: all tools, background processes, feature connections, proactive behavior guidelines, and how the app layout works. Keep it accurate.
- Small UI tweaks and copy changes don't need a manual update — only changes that affect what the bot can do or how features work.

## Crosby Eval Skill (QA Co-Pilot)
- The eval skill lives at `.claude/commands/crosby-eval/SKILL.md`. It's what Jason uses with Claude Code to QA Crosby's responses.
- The skill is designed to dynamically discover the current app state (tables, tools, prompt rules, crons) at the start of each eval session, so it stays current without manual updates for most changes.
- **However, if you make a structural change that affects how eval should work** - like changing how tool calls are stored in messages, adding a new evaluation dimension, changing the background job execution flow, or restructuring the system prompt format - update the eval skill to reflect that change.
- The eval skill does NOT need updates for: new tables, new tools, new cron jobs, prompt wording changes, or new features. It discovers those dynamically.
- It DOES need updates for: changes to message format/storage, changes to how tool calls are embedded in content, new workflow modes, or architectural changes to the chat pipeline.
