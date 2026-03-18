/**
 * iMessage Discovery Helper
 * Reads chat.db directly to show top contacts and group chats from the last 7 days.
 * Cross-checks against Supabase to show what's already configured.
 *
 * Run with: npx tsx scripts/imessage-discovery.ts
 *
 * Requires: Full Disk Access for Terminal in System Settings > Privacy & Security
 * Env vars: BRIDGE_API_KEY (required), CROSBY_API_URL (default: http://localhost:3010)
 */

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const DB_PATH = process.env.IMESSAGE_DB_PATH ?? path.join(os.homedir(), 'Library/Messages/chat.db');
const API_URL = process.env.CROSBY_API_URL ?? 'http://localhost:3010';
const API_KEY = process.env.BRIDGE_API_KEY ?? '';
const LOOKBACK_DAYS = 7;

if (!API_KEY) {
  console.error('BRIDGE_API_KEY is required.');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function appleToDate(appleDate: number | bigint): Date {
  const ms = typeof appleDate === 'bigint'
    ? Number(appleDate) / 1_000_000
    : appleDate / 1_000_000;
  return new Date(ms + 978307200000);
}

function dateToApple(d: Date): number {
  return (d.getTime() - 978307200000) * 1_000_000;
}

function normalizePhone(raw: string | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return raw.trim();
}

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

function resolveText(row: { text: string | null; attributedBody: Buffer | null }): string {
  if (row.attributedBody) {
    const blob = Buffer.isBuffer(row.attributedBody)
      ? row.attributedBody
      : Buffer.from(row.attributedBody as unknown as ArrayBuffer);
    const decoded = decodeAttributedBody(blob);
    if (decoded && decoded.trim() && decoded !== '\uFFFC') return decoded;
  }
  return row.text ?? '';
}

// ── Table rendering ───────────────────────────────────────────────────────────

function truncate(s: string, maxLen: number): string {
  const flat = s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > maxLen ? flat.slice(0, maxLen - 1) + '…' : flat;
}

function pad(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  const str = String(s);
  if (str.length >= width) return str.slice(0, width);
  return align === 'right' ? str.padStart(width) : str.padEnd(width);
}

function printTable(headers: string[], rows: string[][], colWidths: number[]) {
  const sep = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const headerRow = '|' + headers.map((h, i) => ` ${pad(h, colWidths[i])} `).join('|') + '|';

  console.log(sep);
  console.log(headerRow);
  console.log(sep);
  for (const row of rows) {
    console.log('|' + row.map((cell, i) => ` ${pad(cell, colWidths[i])} `).join('|') + '|');
  }
  console.log(sep);
}

// ── API calls (check existing config) ────────────────────────────────────────

const apiHeaders = { 'x-bridge-api-key': API_KEY };

async function getExistingContacts(): Promise<Set<string>> {
  try {
    const res = await fetch(`${API_URL}/api/texts/whitelisted-groups`, { headers: apiHeaders });
    // We actually want text_contacts — call manage_text_contacts list via chat? No, call supabase directly via API
    // Use the same pattern: call our own API. But we don't have a list endpoint for contacts exposed.
    // Fall back: just return empty and note it's unchecked.
    void res;
    return new Set();
  } catch {
    return new Set();
  }
}

async function getWhitelistedGroups(): Promise<Set<string>> {
  try {
    const res = await fetch(`${API_URL}/api/texts/whitelisted-groups`, { headers: apiHeaders });
    if (!res.ok) return new Set();
    const data = await res.json() as { groups: string[] };
    return new Set(data.groups ?? []);
  } catch {
    return new Set();
  }
}

// Direct Supabase check for contacts (the whitelisted-groups endpoint exists but contacts don't have a list endpoint)
// We call the Crosby API's manage_text_contacts equivalent by hitting Supabase env vars directly
async function getExistingContactPhones(): Promise<Set<string>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Try loading from .env.local
    try {
      const fs = await import('fs');
      const envPath = path.join(process.cwd(), '.env.local');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        for (const line of envContent.split('\n')) {
          const [key, ...rest] = line.split('=');
          const val = rest.join('=').trim();
          if (key?.trim() === 'NEXT_PUBLIC_SUPABASE_URL') process.env.NEXT_PUBLIC_SUPABASE_URL = val;
          if (key?.trim() === 'SUPABASE_SERVICE_ROLE_KEY') process.env.SUPABASE_SERVICE_ROLE_KEY = val;
        }
      }
    } catch { /* ignore */ }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new Set();

  try {
    const res = await fetch(`${url}/rest/v1/text_contacts?select=phone_number`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return new Set();
    const data = await res.json() as { phone_number: string }[];
    return new Set(data.map(r => r.phone_number));
  } catch {
    return new Set();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nOpening: ${DB_PATH}`);

  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const cutoff = dateToApple(new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000));

  // ── 1. TOP CONTACTS ──────────────────────────────────────────────────────────

  console.log('\nFetching top contacts...');

  type ContactRow = {
    handle: string;
    msg_count: number;
    last_date: number | bigint;
    last_text: string | null;
    last_attributedBody: Buffer | null;
  };

  // Step 1: get message counts and latest date per handle
  type ContactAgg = { handle: string; msg_count: number; last_date: number | bigint };
  const contactAgg = db.prepare(`
    SELECT
      h.id        AS handle,
      COUNT(m.ROWID) AS msg_count,
      MAX(m.date) AS last_date
    FROM message m
    JOIN handle h ON m.handle_id = h.ROWID
    WHERE m.date >= ?
      AND h.id NOT LIKE '%@%'
    GROUP BY h.id
    ORDER BY msg_count DESC
    LIMIT 30
  `).all(cutoff) as ContactAgg[];

  // Step 2: for each handle, fetch the most recent message separately
  const contactRows: ContactRow[] = contactAgg.map(agg => {
    const latest = db.prepare(`
      SELECT m.text, m.attributedBody
      FROM message m
      JOIN handle h ON m.handle_id = h.ROWID
      WHERE h.id = ? AND m.date = ?
      LIMIT 1
    `).get(agg.handle, agg.last_date) as { text: string | null; attributedBody: Buffer | null } | undefined;
    return {
      handle: agg.handle,
      msg_count: agg.msg_count,
      last_date: agg.last_date,
      last_text: latest?.text ?? null,
      last_attributedBody: latest?.attributedBody ?? null,
    };
  });

  // Load existing contacts from Supabase
  const existingPhones = await getExistingContactPhones();

  console.log(`\n${'═'.repeat(110)}`);
  console.log(`  TOP ${contactRows.length} CONTACTS — last ${LOOKBACK_DAYS} days`);
  console.log(`  (${existingPhones.size > 0 ? `${existingPhones.size} already saved in Supabase` : 'could not check Supabase — run with .env.local in scope'})`);
  console.log(`${'═'.repeat(110)}\n`);

  const contactTableRows = contactRows.map((r, i) => {
    const phone = normalizePhone(r.handle);
    const date = appleToDate(r.last_date);
    const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    const sample = truncate(resolveText({ text: r.last_text ?? null, attributedBody: r.last_attributedBody ?? null }), 70);
    const saved = existingPhones.size > 0 ? (existingPhones.has(phone) ? '✓ saved' : '') : '?';
    return [
      String(i + 1),
      phone || r.handle,
      String(r.msg_count),
      timeStr,
      sample,
      saved,
    ];
  });

  printTable(
    ['#', 'Phone Number', 'Msgs', 'Last Message', 'Sample Text', 'In DB'],
    contactTableRows,
    [3, 16, 4, 19, 70, 8],
  );

  console.log('\nTip: Tell Crosby "that +14085551234 is Roger, he\'s a GM" and it will save the contact.');

  // ── 2. GROUP CHATS ───────────────────────────────────────────────────────────

  console.log('\nFetching group chats...');

  type GroupRow = {
    chat_identifier: string;
    display_name: string | null;
    msg_count: number;
    last_date: number | bigint;
    last_text: string | null;
    last_attributedBody: Buffer | null;
    participant_count: number;
  };

  type GroupAgg = {
    chat_rowid: number;
    chat_identifier: string;
    display_name: string | null;
    msg_count: number;
    last_date: number | bigint;
    participant_count: number;
  };

  const groupAgg = db.prepare(`
    SELECT
      c.ROWID                                 AS chat_rowid,
      c.chat_identifier,
      c.display_name,
      COUNT(m.ROWID)                          AS msg_count,
      MAX(m.date)                             AS last_date,
      (SELECT COUNT(*) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) AS participant_count
    FROM chat c
    JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
    JOIN message m ON m.ROWID = cmj.message_id
    WHERE c.style = 43
      AND m.date >= ?
    GROUP BY c.ROWID
    ORDER BY msg_count DESC
  `).all(cutoff) as GroupAgg[];

  const groupRows: GroupRow[] = groupAgg.map(agg => {
    const latest = db.prepare(`
      SELECT m.text, m.attributedBody
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      WHERE cmj.chat_id = ? AND m.date = ?
      LIMIT 1
    `).get(agg.chat_rowid, agg.last_date) as { text: string | null; attributedBody: Buffer | null } | undefined;
    return {
      chat_identifier: agg.chat_identifier,
      display_name: agg.display_name,
      msg_count: agg.msg_count,
      last_date: agg.last_date,
      last_text: latest?.text ?? null,
      last_attributedBody: latest?.attributedBody ?? null,
      participant_count: agg.participant_count,
    };
  });

  // Load whitelisted groups
  const whitelistedGroups = await getWhitelistedGroups();

  console.log(`\n${'═'.repeat(110)}`);
  console.log(`  GROUP CHATS — last ${LOOKBACK_DAYS} days (${groupRows.length} found)`);
  console.log(`  (${whitelistedGroups.size} already whitelisted)`);
  console.log(`${'═'.repeat(110)}\n`);

  if (groupRows.length === 0) {
    console.log('  No group chats found in the last 7 days.\n');
  } else {
    const groupTableRows = groupRows.map((r, i) => {
      const date = appleToDate(r.last_date);
      const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
      const name = truncate(r.display_name ?? '(no name)', 28);
      const sample = truncate(resolveText({ text: r.last_text ?? null, attributedBody: r.last_attributedBody ?? null }), 50);
      const wl = whitelistedGroups.has(r.chat_identifier) ? '✓ listed' : '';
      return [
        String(i + 1),
        truncate(r.chat_identifier, 36),
        name,
        String(r.participant_count),
        String(r.msg_count),
        timeStr,
        sample,
        wl,
      ];
    });

    printTable(
      ['#', 'chat_identifier', 'Display Name', 'Ppl', 'Msgs', 'Last Active', 'Sample Text', 'Status'],
      groupTableRows,
      [3, 36, 28, 4, 4, 19, 50, 8],
    );

    console.log('\nTip: Tell Crosby "whitelist the \'chat1234\' group, call it Store Managers" and it will add it.');
    console.log('     Or use manage_group_whitelist tool: list_available_groups shows unwhitelisted groups.\n');
  }

  db.close();
}

main().catch(err => {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'ENOENT') {
    console.error('\nERROR: chat.db not found.');
    console.error('→ Grant Full Disk Access: System Settings → Privacy & Security → Full Disk Access');
  } else {
    console.error('\nERROR:', e.message ?? e);
  }
  process.exit(1);
});
