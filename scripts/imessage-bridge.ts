/**
 * iMessage Bridge
 * ───────────────────────────────────────────────────────────────────────────
 * Reads messages from the local macOS chat.db and POSTs them to Crosby's API.
 *
 * REQUIREMENTS
 *   • Full Disk Access must be granted to whichever app runs this script
 *     (Terminal, iTerm2, VS Code, etc.).
 *     System Settings → Privacy & Security → Full Disk Access → add your terminal
 *
 *   • The Mac must be awake for texts to sync. Sleep = no sync.
 *
 * RUNNING IN THE BACKGROUND (recommended)
 *   Install pm2 once:  npm install -g pm2
 *   Start:  pm2 start "npx tsx scripts/imessage-bridge.ts" --name imessage-bridge
 *   Logs:   pm2 logs imessage-bridge
 *   Stop:   pm2 stop imessage-bridge
 *   Auto-start on login: pm2 startup && pm2 save
 *
 * GROUP CHATS
 *   Group messages are only synced if the group's chat_identifier exists in the
 *   text_group_whitelist table in Supabase. Add groups via the Crosby UI or
 *   directly in the DB. 1:1 messages are always synced.
 *
 * ENVIRONMENT VARIABLES
 *   CROSBY_API_URL   Base URL for Crosby API (default: http://localhost:3010)
 *   BRIDGE_API_KEY   Required. API key sent as x-bridge-api-key header.
 *   IMESSAGE_DB_PATH Path to chat.db (default: ~/Library/Messages/chat.db)
 */

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { normalizePhone } from '../src/lib/phone';

// ── Config ──────────────────────────────────────────────────────────────────

const API_URL = process.env.CROSBY_API_URL ?? 'http://localhost:3010';
const API_KEY = process.env.BRIDGE_API_KEY ?? '';
const DB_PATH = process.env.IMESSAGE_DB_PATH
  ?? path.join(os.homedir(), 'Library/Messages/chat.db');

const POLL_INTERVAL_MS = 60_000;
const BATCH_SIZE = 50;
const LOCK_RETRY_COUNT = 3;
const LOCK_RETRY_DELAY_MS = 5_000;
const LOOKBACK_DAYS = 7;

if (!API_KEY) {
  console.error('[bridge] BRIDGE_API_KEY is required. Set it before running.');
  process.exit(1);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatDbMessage {
  ROWID: number;
  handle: string | null;
  text: string | null;
  attributedBody: Buffer | null;
  is_from_me: number;
  service: string | null;
  date: number | bigint;
  cache_has_attachments: number;
  chat_identifier: string | null;
  chat_display_name: string | null;
  is_group: number; // 1 if chat has style=43 (group) or multiple participants
}

interface IngestPayload {
  phone_number: string;
  message_text: string;
  is_from_me: boolean;
  is_group_chat: boolean;
  group_chat_name: string | null;
  chat_identifier: string | null;
  service: string;
  chat_db_row_id: number;
  message_date: string; // ISO
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Convert Apple epoch (nanoseconds since 2001-01-01) to JS Date */
function appleToDate(appleDate: number | bigint): Date {
  const ms = typeof appleDate === 'bigint'
    ? Number(appleDate) / 1_000_000
    : appleDate / 1_000_000;
  return new Date(ms + 978307200000);
}

/** Convert JS Date to Apple epoch (nanoseconds since 2001-01-01) */
function dateToApple(d: Date): number {
  return (d.getTime() - 978307200000) * 1_000_000;
}

/**
 * Decode NSKeyedArchiver "streamtyped" binary blob (attributedBody column).
 *
 * Format: ... "NSString" \x01 \x95|\x94 \x84 \x01 \x2b [len] [utf8 bytes]
 * Length encoding (LE):
 *   byte < 0x80  → 1-byte length
 *   byte == 0x81 → 2-byte LE uint16
 *   byte == 0x82 → 4-byte LE uint32
 * Length is the UTF-8 byte count.
 */
function decodeAttributedBody(blob: Buffer): string | null {
  const NS_STRING = Buffer.from('NSString', 'utf8');
  const nsIdx = blob.indexOf(NS_STRING);
  if (nsIdx < 0) return null;

  let markerIdx = -1;
  for (let i = nsIdx + NS_STRING.length; i < nsIdx + NS_STRING.length + 10; i++) {
    if (blob[i] === 0x2b) { markerIdx = i; break; }
  }
  if (markerIdx < 0) return null;

  const lenOffset = markerIdx + 1;
  const lenByte = blob[lenOffset];
  let textOffset: number;
  let byteLen: number;

  if (lenByte < 0x80) {
    byteLen = lenByte;
    textOffset = lenOffset + 1;
  } else if (lenByte === 0x81) {
    byteLen = blob.readUInt16LE(lenOffset + 1);
    textOffset = lenOffset + 3;
  } else if (lenByte === 0x82) {
    byteLen = blob.readUInt32LE(lenOffset + 1);
    textOffset = lenOffset + 5;
  } else {
    return null;
  }

  if (textOffset + byteLen > blob.length) return null;
  return blob.slice(textOffset, textOffset + byteLen).toString('utf8');
}


function serviceLabel(service: string | null): string {
  if (!service) return 'unknown';
  const s = service.toLowerCase();
  if (s.includes('imessage')) return 'iMessage';
  if (s.includes('sms')) return 'SMS';
  return service;
}

// ── API calls ─────────────────────────────────────────────────────────────────

const apiHeaders = {
  'Content-Type': 'application/json',
  'x-bridge-api-key': API_KEY,
};

async function getLatestRowId(): Promise<number> {
  const res = await fetch(`${API_URL}/api/texts/latest-row-id`, { headers: apiHeaders });
  if (!res.ok) throw new Error(`latest-row-id ${res.status}: ${await res.text()}`);
  const data = await res.json() as { latest_row_id: number };
  return data.latest_row_id ?? 0;
}

async function getWhitelistedGroups(): Promise<Set<string>> {
  const res = await fetch(`${API_URL}/api/texts/whitelisted-groups`, { headers: apiHeaders });
  if (!res.ok) throw new Error(`whitelisted-groups ${res.status}: ${await res.text()}`);
  const data = await res.json() as { groups: string[] };
  return new Set(data.groups);
}

async function ingestBatch(messages: IngestPayload[]): Promise<void> {
  const res = await fetch(`${API_URL}/api/texts/ingest`, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error(`ingest ${res.status}: ${await res.text()}`);
}

async function postHeartbeat(messagesSynced: number, error?: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/texts/heartbeat`, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({
      bridge_name: 'imessage',
      messages_synced: messagesSynced,
      status: error ? 'stale' : 'healthy',
      error: error ?? null,
    }),
  });
  if (!res.ok) {
    log(`Heartbeat failed (non-fatal): ${res.status}`);
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/** Open chat.db in readonly mode, retrying on SQLITE_BUSY */
async function openDb(): Promise<Database.Database | null> {
  for (let attempt = 1; attempt <= LOCK_RETRY_COUNT; attempt++) {
    try {
      return new Database(DB_PATH, { readonly: true, fileMustExist: true });
    } catch (err: unknown) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('SQLITE_BUSY') || msg.includes('locked')) {
        log(`DB locked (attempt ${attempt}/${LOCK_RETRY_COUNT}), retrying in ${LOCK_RETRY_DELAY_MS / 1000}s...`);
        if (attempt < LOCK_RETRY_COUNT) await sleep(LOCK_RETRY_DELAY_MS);
      } else {
        throw err;
      }
    }
  }
  log('DB locked after all retries — skipping this cycle.');
  return null;
}

/**
 * Find the minimum ROWID where message.date >= the 7-day lookback cutoff.
 * Used only on first run when there's no prior sync state.
 */
function getFirstRowIdForLookback(db: Database.Database): number {
  const cutoff = dateToApple(new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000));
  const row = db.prepare(
    'SELECT MIN(ROWID) as min_rowid FROM message WHERE date >= ?'
  ).get(cutoff) as { min_rowid: number | null };
  return row.min_rowid ?? 0;
}

/** Query all new messages from chat.db since lastRowId */
function fetchNewMessages(db: Database.Database, lastRowId: number): ChatDbMessage[] {
  return db.prepare(`
    SELECT
      m.ROWID,
      h.id                AS handle,
      m.text,
      m.attributedBody,
      m.is_from_me,
      m.service,
      m.date,
      m.cache_has_attachments,
      c.chat_identifier,
      c.display_name      AS chat_display_name,
      CASE WHEN c.style = 43 OR c.room_name IS NOT NULL THEN 1 ELSE 0 END AS is_group
    FROM message m
    LEFT JOIN handle h             ON m.handle_id = h.ROWID
    LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    LEFT JOIN chat c               ON c.ROWID = cmj.chat_id
    WHERE m.ROWID > ?
    ORDER BY m.ROWID ASC
  `).all(lastRowId) as ChatDbMessage[];
}

// ── Main sync cycle ───────────────────────────────────────────────────────────

async function syncCycle(): Promise<void> {
  let db: Database.Database | null = null;

  try {
    // 1. Get last synced row from API
    let lastRowId: number;
    try {
      lastRowId = await getLatestRowId();
    } catch (err) {
      log(`Could not reach API (latest-row-id): ${(err as Error).message}`);
      return;
    }

    // 2. Open DB
    db = await openDb();
    if (!db) return;

    // 3. On first run (no prior sync), clamp to 7-day lookback
    if (lastRowId === 0) {
      lastRowId = getFirstRowIdForLookback(db);
      log(`First run — starting from ROWID ${lastRowId} (~${LOOKBACK_DAYS} days back)`);
    }

    // 4. Fetch new messages
    const rows = fetchNewMessages(db, lastRowId);
    if (rows.length === 0) {
      log('No new messages.');
      await postHeartbeat(0);
      return;
    }

    // 5. Get whitelisted groups
    let whitelist: Set<string>;
    try {
      whitelist = await getWhitelistedGroups();
    } catch (err) {
      log(`Could not fetch whitelist: ${(err as Error).message} — skipping cycle`);
      return;
    }

    // 6. Process rows
    const batch: IngestPayload[] = [];
    let skippedAttachment = 0;
    let skippedGroup = 0;

    for (const row of rows) {
      // Decode text
      let text: string | null = null;

      if (row.attributedBody) {
        const blob = Buffer.isBuffer(row.attributedBody)
          ? row.attributedBody
          : Buffer.from(row.attributedBody as unknown as ArrayBuffer);
        text = decodeAttributedBody(blob);
      }

      if (!text && row.text) text = row.text;

      // Skip attachment-only (no readable text)
      if (!text || text.trim() === '' || text === '\uFFFC') {
        skippedAttachment++;
        continue;
      }

      // Group chat whitelist check
      const isGroup = row.is_group === 1;
      if (isGroup && row.chat_identifier && !whitelist.has(row.chat_identifier)) {
        skippedGroup++;
        continue;
      }

      batch.push({
        phone_number: normalizePhone(row.handle),
        message_text: text,
        is_from_me: row.is_from_me === 1,
        is_group_chat: !!isGroup,
        group_chat_name: row.chat_display_name ?? null,
        chat_identifier: row.chat_identifier ?? null,
        service: serviceLabel(row.service),
        chat_db_row_id: row.ROWID,
        message_date: appleToDate(row.date).toISOString(),
      });
    }

    // 7. POST in batches of 50
    let totalSynced = 0;
    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      const chunk = batch.slice(i, i + BATCH_SIZE);
      try {
        await ingestBatch(chunk);
        totalSynced += chunk.length;
      } catch (err) {
        log(`Ingest batch failed: ${(err as Error).message}`);
        // Continue — partial sync is better than no sync
      }
    }

    log(
      `Synced ${totalSynced} messages, ` +
      `${skippedAttachment} skipped (attachment-only), ` +
      `${skippedGroup} skipped (non-whitelisted group)`
    );

    await postHeartbeat(totalSynced);

  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    log(`Cycle error: ${msg}`);
    try { await postHeartbeat(0, msg); } catch { /* non-fatal */ }
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

log(`iMessage bridge starting — polling every ${POLL_INTERVAL_MS / 1000}s`);
log(`DB: ${DB_PATH}`);
log(`API: ${API_URL}`);

// Run immediately, then on interval
syncCycle().then(() => {
  setInterval(() => { syncCycle(); }, POLL_INTERVAL_MS);
});
