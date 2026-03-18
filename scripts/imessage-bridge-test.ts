import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const DB_PATH = path.join(os.homedir(), 'Library/Messages/chat.db');

function convertAppleDate(appleDate: number | bigint): Date {
  const ms = typeof appleDate === 'bigint'
    ? Number(appleDate) / 1_000_000
    : appleDate / 1_000_000;
  return new Date(ms + 978307200000);
}

function serviceLabel(service: string | null): string {
  if (!service) return 'unknown';
  if (service.toLowerCase().includes('imessage')) return 'iMessage';
  if (service.toLowerCase().includes('sms')) return 'SMS';
  return service;
}

/**
 * Decode the NSKeyedArchiver "streamtyped" binary format used in attributedBody.
 *
 * The format is NOT a standard binary plist. It's Apple's older NSArchiver/streamtyped
 * wire format. The plain text string is stored as an NSString object and is preceded by
 * the marker bytes: ... NSString \x01 \x95|\x94 \x84 \x01 \x2b [length] [utf8 bytes]
 *
 * Length encoding (little-endian):
 *   byte < 0x80  → length = that byte (1 byte)
 *   byte == 0x81 → length = next 2 bytes as LE uint16
 *   byte == 0x82 → length = next 4 bytes as LE uint32
 *
 * The length is the UTF-8 *byte* count, not the character count.
 */
function decodeAttributedBody(blob: Buffer): string | null {
  // Find the NSString class marker — always present for text messages
  const NS_STRING = Buffer.from('NSString', 'utf8');
  // After NSString, there are 5 fixed bytes (\x01 \x95|\x94 \x84 \x01 \x2b) before the length.
  // We don't hard-code those — instead we find NSString then scan forward for \x2b ('+')
  // which consistently appears as the last byte of the fixed header.
  const nsIdx = blob.indexOf(NS_STRING);
  if (nsIdx < 0) return null;

  // Scan the next ~10 bytes for the 0x2b marker
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

try {
  console.log(`Opening: ${DB_PATH}\n`);
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

  // ── Stats ────────────────────────────────────────────────────────────────
  const totalRows = (db.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number }).count;
  const uniqueHandles = (db.prepare('SELECT COUNT(DISTINCT id) as count FROM handle').get() as { count: number }).count;
  const imessageCount = (db.prepare("SELECT COUNT(*) as count FROM message WHERE service = 'iMessage'").get() as { count: number }).count;
  const smsCount = (db.prepare("SELECT COUNT(*) as count FROM message WHERE service = 'SMS'").get() as { count: number }).count;
  const nullTextCount = (db.prepare('SELECT COUNT(*) as count FROM message WHERE text IS NULL').get() as { count: number }).count;
  const hasBodyCount = (db.prepare('SELECT COUNT(*) as count FROM message WHERE attributedBody IS NOT NULL').get() as { count: number }).count;

  console.log('═══════════════════════════════════════════════════════');
  console.log('  DATABASE STATS');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total messages:      ${totalRows.toLocaleString()}`);
  console.log(`  Unique handles:      ${uniqueHandles.toLocaleString()}`);
  console.log(`  iMessage:            ${imessageCount.toLocaleString()}`);
  console.log(`  SMS:                 ${smsCount.toLocaleString()}`);
  console.log(`  Null text col:       ${nullTextCount.toLocaleString()} (${((nullTextCount / totalRows) * 100).toFixed(1)}%)`);
  console.log(`  Has attributedBody:  ${hasBodyCount.toLocaleString()} (${((hasBodyCount / totalRows) * 100).toFixed(1)}%)`);
  console.log('═══════════════════════════════════════════════════════\n');

  // ── Last 50 messages with attributedBody decoding ────────────────────────
  type MsgRow = {
    ROWID: number;
    handle: string | null;
    text: string | null;
    attributedBody: Buffer | null;
    is_from_me: number;
    service: string | null;
    date: number | bigint;
    cache_has_attachments: number;
  };

  const rows = db.prepare(`
    SELECT
      m.ROWID,
      h.id              AS handle,
      m.text,
      m.attributedBody,
      m.is_from_me,
      m.service,
      m.date,
      m.cache_has_attachments
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    ORDER BY m.ROWID DESC
    LIMIT 50
  `).all() as MsgRow[];

  console.log('  LAST 50 MESSAGES — decoded attributedBody (newest first)');
  console.log('═══════════════════════════════════════════════════════\n');

  let decoded = 0, fromTextCol = 0, attachmentOnly = 0, failed = 0;

  for (const row of rows) {
    const ts = convertAppleDate(row.date);
    const direction = row.is_from_me ? '→ out' : '← in ';
    const svc = serviceLabel(row.service);
    const handle = row.handle ?? '(group / no handle)';

    // Resolve text: attributedBody first, fall back to text col, then attachment label
    let resolvedText: string | null = null;
    let source = '';

    if (row.attributedBody) {
      const blob = Buffer.isBuffer(row.attributedBody)
        ? row.attributedBody
        : Buffer.from(row.attributedBody as unknown as ArrayBuffer);
      resolvedText = decodeAttributedBody(blob);
      if (resolvedText) { decoded++; source = '[attributedBody]'; }
    }

    if (!resolvedText && row.text) {
      resolvedText = row.text;
      fromTextCol++;
      source = '[text col]';
    }

    if (!resolvedText) {
      if (row.cache_has_attachments) {
        resolvedText = null;
        attachmentOnly++;
        source = '[attachment]';
      } else {
        failed++;
        source = '[no text]';
      }
    }

    const preview = resolvedText
      ? resolvedText.slice(0, 120).replace(/\n/g, ' ')
      : '—';

    console.log(`ROWID ${row.ROWID}  |  ${svc}  |  ${direction}  |  ${source}`);
    console.log(`  Handle: ${handle}`);
    console.log(`  Date:   ${ts.toLocaleString()}`);
    console.log(`  Text:   ${preview}`);
    console.log();
  }

  // ── Extraction summary ───────────────────────────────────────────────────
  const total50 = rows.length;
  console.log('═══════════════════════════════════════════════════════');
  console.log('  EXTRACTION SUMMARY (last 50 messages)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Decoded from attributedBody: ${decoded}  (${((decoded / total50) * 100).toFixed(0)}%)`);
  console.log(`  From text column fallback:   ${fromTextCol}  (${((fromTextCol / total50) * 100).toFixed(0)}%)`);
  console.log(`  Attachment-only (no text):   ${attachmentOnly}  (${((attachmentOnly / total50) * 100).toFixed(0)}%)`);
  console.log(`  Failed / unreadable:         ${failed}  (${((failed / total50) * 100).toFixed(0)}%)`);
  console.log(`  Total with readable text:    ${decoded + fromTextCol} / ${total50}  (${(((decoded + fromTextCol) / total50) * 100).toFixed(0)}%)`);
  console.log('═══════════════════════════════════════════════════════\n');

  // ── Accuracy check: compare decoded vs text col where both exist ─────────
  const crossCheckRows = db.prepare(`
    SELECT ROWID, text, attributedBody
    FROM message
    WHERE text IS NOT NULL AND attributedBody IS NOT NULL AND length(text) > 5
    LIMIT 100
  `).all() as Array<{ ROWID: number; text: string; attributedBody: Buffer }>;

  let ccMatch = 0, ccMismatch = 0, ccFail = 0;
  const mismatches: string[] = [];

  for (const r of crossCheckRows) {
    const blob = Buffer.isBuffer(r.attributedBody)
      ? r.attributedBody
      : Buffer.from(r.attributedBody as unknown as ArrayBuffer);
    const extracted = decodeAttributedBody(blob);
    if (!extracted) { ccFail++; continue; }
    if (extracted === r.text) {
      ccMatch++;
    } else {
      ccMismatch++;
      if (mismatches.length < 3) {
        mismatches.push(`  ROWID ${r.ROWID}\n    text col:  ${r.text.slice(0, 60)}\n    extracted: ${extracted.slice(0, 60)}`);
      }
    }
  }

  console.log('  ACCURACY CHECK (100 messages where both text col & attributedBody exist)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Exact match:   ${ccMatch}`);
  console.log(`  Mismatch:      ${ccMismatch}`);
  console.log(`  Decode failed: ${ccFail}`);
  if (mismatches.length) {
    console.log('\n  Sample mismatches:');
    for (const m of mismatches) console.log(m);
  }
  console.log();

  db.close();
} catch (err: unknown) {
  const error = err as NodeJS.ErrnoException;

  if (error.code === 'ENOENT') {
    console.error('ERROR: chat.db not found at', DB_PATH);
    console.error('→ Grant Full Disk Access: System Settings → Privacy & Security → Full Disk Access');
  } else if (error.message?.includes('SQLITE_BUSY') || error.message?.includes('locked')) {
    console.error('ERROR: Database is locked.');
    console.error('→ Readonly mode should still work — try closing Messages app and re-running.');
    console.error('→ Raw error:', error.message);
  } else {
    console.error('ERROR:', error.message ?? error);
  }
  process.exit(1);
}
