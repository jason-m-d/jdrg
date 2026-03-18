-- iMessage Bridge Tables
-- text_messages: imported messages from chat.db
-- bridge_heartbeats: liveness tracking for the local bridge process
-- text_contacts: known contacts with roles
-- text_group_whitelist: group chats approved for ingestion

-- 1. text_messages
CREATE TABLE IF NOT EXISTS text_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number      TEXT NOT NULL,                          -- normalized: +1XXXXXXXXXX
  contact_name      TEXT,                                   -- resolved from text_contacts
  message_text      TEXT NOT NULL,
  is_from_me        BOOLEAN NOT NULL DEFAULT false,
  is_group_chat     BOOLEAN NOT NULL DEFAULT false,
  group_chat_name   TEXT,
  chat_identifier   TEXT,                                   -- chat.chat_identifier from chat.db
  service           TEXT NOT NULL,                          -- 'iMessage' or 'SMS'
  chat_db_row_id    BIGINT UNIQUE NOT NULL,                 -- ROWID in chat.db, prevents double-import
  message_date      TIMESTAMPTZ NOT NULL,
  ingested_at       TIMESTAMPTZ DEFAULT now(),
  scanned           BOOLEAN DEFAULT false,
  flagged           BOOLEAN DEFAULT false,
  flag_reason       TEXT,
  session_id        UUID REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_text_messages_message_date    ON text_messages(message_date);
CREATE INDEX IF NOT EXISTS idx_text_messages_scanned         ON text_messages(scanned);
CREATE INDEX IF NOT EXISTS idx_text_messages_phone_number    ON text_messages(phone_number);
CREATE INDEX IF NOT EXISTS idx_text_messages_chat_db_row_id  ON text_messages(chat_db_row_id);
CREATE INDEX IF NOT EXISTS idx_text_messages_chat_identifier ON text_messages(chat_identifier);
CREATE INDEX IF NOT EXISTS idx_text_messages_ingested_at     ON text_messages(ingested_at);

-- 2. bridge_heartbeats
CREATE TABLE IF NOT EXISTS bridge_heartbeats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bridge_name       TEXT NOT NULL DEFAULT 'imessage',
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            TEXT NOT NULL DEFAULT 'healthy',        -- 'healthy', 'stale', 'dead'
  messages_synced   INT DEFAULT 0,
  error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_bridge_heartbeats_name ON bridge_heartbeats(bridge_name);

-- 3. text_contacts
CREATE TABLE IF NOT EXISTS text_contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT UNIQUE NOT NULL,                        -- normalized: +1XXXXXXXXXX
  contact_name TEXT NOT NULL,
  role         TEXT,                                        -- 'gm', 'vendor', 'admin', 'personal', etc.
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 4. text_group_whitelist
CREATE TABLE IF NOT EXISTS text_group_whitelist (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_identifier TEXT UNIQUE NOT NULL,                     -- chat.chat_identifier from chat.db
  display_name   TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Seed text_contacts with placeholder entries (fill in real numbers later)
INSERT INTO text_contacts (phone_number, contact_name, role) VALUES
  ('+10000000001', 'Roger', 'gm'),
  ('+10000000002', 'Jenny', 'admin'),
  ('+10000000003', 'Eli',   'ops')
ON CONFLICT (phone_number) DO NOTHING;
