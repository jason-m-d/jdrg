-- Calendar integration tables
-- Run: PGPASSWORD="..." psql -h db.wzhdyfprmgalyvodwrxf.supabase.co -U postgres -d postgres -f scripts/create-calendar-tables.sql

-- Calendar tokens (same shape as google_tokens)
CREATE TABLE IF NOT EXISTS calendar_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account text UNIQUE NOT NULL,
  refresh_token text NOT NULL,
  access_token text,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Calendar events
CREATE TABLE IF NOT EXISTS calendar_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id text,
  account text NOT NULL,
  google_event_id text NOT NULL,
  calendar_id text,
  title text,
  description text,
  start_time timestamptz,
  end_time timestamptz,
  location text,
  attendees jsonb DEFAULT '[]'::jsonb,
  all_day boolean DEFAULT false,
  recurring_event_id text,
  status text,
  organizer_email text,
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (account, google_event_id)
);

-- Calendar syncs tracking
CREATE TABLE IF NOT EXISTS calendar_syncs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account text UNIQUE NOT NULL,
  last_synced_at timestamptz,
  events_synced integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_calendar_events_account ON calendar_events (account);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start_time ON calendar_events (start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_account_start ON calendar_events (account, start_time);
