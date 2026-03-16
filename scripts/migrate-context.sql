-- Project Context migration
-- Run this in the Supabase SQL Editor

-- Project context entries
CREATE TABLE IF NOT EXISTS project_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  source_conversation_id uuid REFERENCES conversations(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Context chunks (vector embeddings for RAG)
CREATE TABLE IF NOT EXISTS context_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_id uuid REFERENCES project_context(id) ON DELETE CASCADE,
  chunk_index integer,
  content text,
  embedding vector(1024),
  created_at timestamptz DEFAULT now()
);

-- Vector similarity search for context chunks
CREATE OR REPLACE FUNCTION match_context(query_embedding vector(1024), match_threshold float, match_count int)
RETURNS TABLE (id uuid, context_id uuid, chunk_index int, content text, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT cc.id, cc.context_id, cc.chunk_index, cc.content,
    1 - (cc.embedding <=> query_embedding) as similarity
  FROM context_chunks cc
  WHERE 1 - (cc.embedding <=> query_embedding) > match_threshold
  ORDER BY cc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- RLS
ALTER TABLE project_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated access" ON project_context FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON context_chunks FOR ALL TO authenticated USING (true) WITH CHECK (true);
