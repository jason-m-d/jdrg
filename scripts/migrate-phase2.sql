-- Phase 2: Making Crosby Feel Intelligent
-- Run via Supabase MCP or psql

-- 1. Add forecast/budget columns to sales_data
ALTER TABLE sales_data ADD COLUMN IF NOT EXISTS forecast_sales decimal;
ALTER TABLE sales_data ADD COLUMN IF NOT EXISTS budget_sales decimal;

-- 2. Add dismissal_reason to action_items
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS dismissal_reason text;

-- 3. Backfill source on action_items where null
UPDATE action_items SET source = 'user_created' WHERE source IS NULL;

-- 4. Create decisions table
CREATE TABLE IF NOT EXISTS decisions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid REFERENCES sessions(id),
  conversation_id uuid REFERENCES conversations(id),
  project_id uuid REFERENCES projects(id),
  decision_text text NOT NULL,
  context text,
  alternatives_considered text,
  decided_at timestamptz DEFAULT now(),
  embedding vector(1024)
);

-- 5. Create index on decisions embedding
CREATE INDEX IF NOT EXISTS decisions_embedding_idx ON decisions
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 6. Create match_decisions RPC (mirrors match_documents)
CREATE OR REPLACE FUNCTION match_decisions(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  session_id uuid,
  conversation_id uuid,
  project_id uuid,
  decision_text text,
  context text,
  alternatives_considered text,
  decided_at timestamptz,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.session_id,
    d.conversation_id,
    d.project_id,
    d.decision_text,
    d.context,
    d.alternatives_considered,
    d.decided_at,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM decisions d
  WHERE d.embedding IS NOT NULL
    AND 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
