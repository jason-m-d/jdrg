-- Phase 3 Migration: Background Jobs, Detected Processes, Auto-Trigger Logging

-- 1. Background jobs table
CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT NOT NULL,
  job_type TEXT NOT NULL, -- 'research', 'analysis', 'briefing', 'sop', 'overnight_build'
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | completed | failed
  prompt TEXT NOT NULL,
  result TEXT,
  trigger_source TEXT, -- 'user', 'nudge_cron', 'email_scan', 'overnight_build', 'sop_detection'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT
);

CREATE INDEX IF NOT EXISTS background_jobs_conversation_idx ON background_jobs(conversation_id);
CREATE INDEX IF NOT EXISTS background_jobs_status_idx ON background_jobs(status);
CREATE INDEX IF NOT EXISTS background_jobs_created_at_idx ON background_jobs(created_at DESC);

-- 2. Detected processes table (for SOP auto-drafting)
CREATE TABLE IF NOT EXISTS detected_processes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_name TEXT NOT NULL,
  conversation_ids TEXT[] NOT NULL DEFAULT '{}',
  step_count INT DEFAULT 0,
  times_explained INT NOT NULL DEFAULT 1,
  last_explained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sop_drafted BOOLEAN NOT NULL DEFAULT FALSE,
  sop_artifact_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS detected_processes_name_idx ON detected_processes(process_name);
CREATE INDEX IF NOT EXISTS detected_processes_times_idx ON detected_processes(times_explained);

-- 3. Auto-trigger log (rate limiting + transparency)
CREATE TABLE IF NOT EXISTS auto_trigger_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type TEXT NOT NULL, -- 'deadline_research', 'sales_anomaly', 'important_email', 'overnight_build'
  trigger_key TEXT, -- e.g. action_item_id, store_number, email_subject - for per-item cooldowns
  background_job_id UUID REFERENCES background_jobs(id),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS auto_trigger_log_type_idx ON auto_trigger_log(trigger_type);
CREATE INDEX IF NOT EXISTS auto_trigger_log_triggered_at_idx ON auto_trigger_log(triggered_at DESC);
CREATE INDEX IF NOT EXISTS auto_trigger_log_trigger_key_idx ON auto_trigger_log(trigger_type, trigger_key);
