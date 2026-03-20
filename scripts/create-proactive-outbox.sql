-- Proactive outbox: tracks all cron-generated messages for dedup and conversation awareness
CREATE TABLE IF NOT EXISTS proactive_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_type TEXT NOT NULL,           -- 'alert', 'heads_up', 'nudge', 'briefing', 'watch_match', 'email_heads_up', 'bridge_status'
  content TEXT NOT NULL,
  source_cron TEXT,                     -- which cron generated it: 'email-scan', 'nudge', 'morning-briefing', 'text-heartbeat-monitor'
  related_item_ids TEXT[] DEFAULT '{}', -- action_item IDs, watch IDs, email IDs referenced
  related_topics TEXT[] DEFAULT '{}',   -- keywords/topics for dedup ('tlc_invoices', 'pci_compliance', 'courtney_randick')
  status TEXT DEFAULT 'sent',           -- 'sent', 'acknowledged', 'dismissed', 'snoozed'
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  message_id UUID                       -- FK to messages table (the actual chat message)
);

-- Index for dedup queries: "was this topic already surfaced today?"
CREATE INDEX IF NOT EXISTS idx_outbox_sent_at ON proactive_outbox (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON proactive_outbox (status);
CREATE INDEX IF NOT EXISTS idx_outbox_message_type ON proactive_outbox (message_type);
CREATE INDEX IF NOT EXISTS idx_outbox_related_topics ON proactive_outbox USING GIN (related_topics);
CREATE INDEX IF NOT EXISTS idx_outbox_related_item_ids ON proactive_outbox USING GIN (related_item_ids);

-- Enable RLS (admin-only access via service role)
ALTER TABLE proactive_outbox ENABLE ROW LEVEL SECURITY;
