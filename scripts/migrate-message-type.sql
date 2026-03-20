-- Add message_type column to messages table for cron message visual design system
-- Types: briefing, nudge, alert, watch_match, email_heads_up, bridge_status

ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type text
  CHECK (message_type IN ('briefing','nudge','alert','watch_match','email_heads_up','bridge_status'));

-- Index for alert-fatigue dedup query and future outbox queries
CREATE INDEX IF NOT EXISTS idx_messages_type_created
  ON messages (message_type, created_at)
  WHERE message_type IS NOT NULL;
