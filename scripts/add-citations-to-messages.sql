-- Add citations column to messages table for web search citation tracking
-- Citations shape: { url, title, snippet, domain }[]
ALTER TABLE messages ADD COLUMN IF NOT EXISTS citations JSONB;
