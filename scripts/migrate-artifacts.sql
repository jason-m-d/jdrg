-- Artifacts table
CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  content text NOT NULL DEFAULT '',
  type text CHECK (type IN ('plan','spec','checklist','freeform')) DEFAULT 'freeform',
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  version integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Version history
CREATE TABLE artifact_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid REFERENCES artifacts(id) ON DELETE CASCADE,
  content text NOT NULL,
  version integer NOT NULL,
  change_summary text,
  changed_by text CHECK (changed_by IN ('user','assistant')) DEFAULT 'user',
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON artifacts FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all for authenticated" ON artifact_versions FOR ALL TO authenticated USING (true);

-- Indexes
CREATE INDEX idx_artifacts_conversation ON artifacts(conversation_id);
CREATE INDEX idx_artifacts_project ON artifacts(project_id);
CREATE INDEX idx_artifact_versions_artifact ON artifact_versions(artifact_id);
