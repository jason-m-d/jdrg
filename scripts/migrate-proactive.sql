-- Migration: Proactive systems (nudges, commitments, email thread tracking)
-- Run via Supabase MCP or psql

-- 1. Add last_nudged_at to action_items
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS last_nudged_at timestamptz;

-- 2. Create commitments table
CREATE TABLE IF NOT EXISTS commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES sessions(id),
  conversation_id uuid REFERENCES conversations(id),
  commitment_text text NOT NULL,
  target_date date,
  related_contact text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'expired')),
  created_at timestamptz DEFAULT now(),
  fulfilled_at timestamptz
);

-- RLS for commitments
ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated access to commitments" ON commitments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Create email_threads table
CREATE TABLE IF NOT EXISTS email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_thread_id text NOT NULL,
  gmail_account text NOT NULL,
  subject text,
  last_sender text,
  last_sender_email text,
  last_message_date timestamptz,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  needs_response boolean DEFAULT false,
  response_detected boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (gmail_thread_id, gmail_account)
);

-- RLS for email_threads
ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated access to email_threads" ON email_threads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
