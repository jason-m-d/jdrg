-- Crosby Database Setup
-- Run this in the Supabase SQL Editor (Database > SQL Editor)

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  system_prompt text,
  color text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text,
  file_url text,
  file_type text CHECK (file_type IN ('pdf','docx','xlsx','text','created')),
  project_id uuid REFERENCES projects(id),
  is_living boolean DEFAULT false,
  is_pinned boolean DEFAULT false,
  is_template boolean DEFAULT false,
  version integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Document versions
CREATE TABLE IF NOT EXISTS document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  content text,
  version integer,
  change_summary text,
  created_at timestamptz DEFAULT now()
);

-- Document chunks (with vector)
CREATE TABLE IF NOT EXISTS document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index integer,
  content text,
  embedding vector(1024),
  created_at timestamptz DEFAULT now()
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  project_id uuid REFERENCES projects(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  role text CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  sources jsonb,
  created_at timestamptz DEFAULT now()
);

-- Memories
CREATE TABLE IF NOT EXISTS memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  category text,
  source_conversation_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Action items
CREATE TABLE IF NOT EXISTS action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  source text CHECK (source IN ('chat','email')),
  source_id text,
  source_snippet text,
  status text CHECK (status IN ('pending','approved','dismissed','completed')) DEFAULT 'pending',
  priority text CHECK (priority IN ('high','medium','low')) DEFAULT 'medium',
  due_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Email scans
CREATE TABLE IF NOT EXISTS email_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account text NOT NULL,
  last_scanned_at timestamptz,
  emails_processed integer DEFAULT 0,
  action_items_found integer DEFAULT 0
);

-- Sales data
CREATE TABLE IF NOT EXISTS sales_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL,
  brand text CHECK (brand IN ('wingstop','mrpickles')),
  store_number text,
  store_name text,
  net_sales decimal,
  transaction_count integer,
  raw_email_id text,
  parsed_at timestamptz DEFAULT now(),
  UNIQUE(report_date, brand, store_number)
);

-- Gmail tokens
CREATE TABLE IF NOT EXISTS google_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account text NOT NULL UNIQUE,
  refresh_token text NOT NULL,
  access_token text,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Vector similarity search function
CREATE OR REPLACE FUNCTION match_documents(query_embedding vector(1024), match_threshold float, match_count int)
RETURNS TABLE (id uuid, document_id uuid, chunk_index int, content text, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT dc.id, dc.document_id, dc.chunk_index, dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  FROM document_chunks dc
  WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Index for vector similarity search (run after inserting some data)
-- CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
-- ON document_chunks USING ivfflat (embedding vector_cosine_ops)
-- WITH (lists = 100);

-- Enable RLS but allow service role access
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_tokens ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access (single-user app)
CREATE POLICY "Allow authenticated access" ON projects FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON documents FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON document_versions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON document_chunks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON conversations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON messages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON memories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON action_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON email_scans FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON sales_data FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON google_tokens FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Create a storage bucket for documents
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policy for authenticated access
CREATE POLICY "Allow authenticated uploads" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents');
CREATE POLICY "Allow authenticated reads" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'documents');
CREATE POLICY "Allow authenticated deletes" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'documents');
