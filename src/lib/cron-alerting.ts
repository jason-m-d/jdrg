/**
 * Cron failure alerting.
 *
 * Call reportCronFailure() from cron route catch blocks.
 * Sends a push notification + proactive message in the main conversation.
 * Rate-limited to 1 alert per cron per hour (prevents alert storms).
 */

import { sendPushToAll } from '@/lib/push'
import { getMainConversation, insertProactiveMessage } from '@/lib/proactive'
import { logError } from '@/lib/activity-log'

// In-memory rate limit: cronName → last alert timestamp
// Resets on function restart (serverless cold start), fine for this use case.
const lastAlertAt = new Map<string, number>()
const RATE_LIMIT_MS = 60 * 60 * 1000 // 1 hour

export async function reportCronFailure(
  cronName: string,
  error: Error | unknown,
  context?: Record<string, unknown>
): Promise<void> {
  const now = Date.now()
  const lastSent = lastAlertAt.get(cronName) ?? 0

  if (now - lastSent < RATE_LIMIT_MS) {
    console.warn(`[cron-alerting] Skipping duplicate alert for ${cronName} (rate limited)`)
    return
  }

  lastAlertAt.set(cronName, now)

  const errorMsg = error instanceof Error ? error.message : String(error)
  const title = `Cron failed: ${cronName}`
  const body = errorMsg.slice(0, 200)

  // Log to crosby_events
  void logError({
    route: `cron/${cronName}`,
    error_type: 'cron_failure',
    error_message: errorMsg,
    context,
  })

  // Push notification
  try {
    await sendPushToAll(title, body, '/dashboard')
  } catch (pushErr) {
    console.error('[cron-alerting] Push failed:', pushErr)
  }

  // Proactive message in main conversation
  try {
    const convId = await getMainConversation()
    await insertProactiveMessage(
      convId,
      `**Cron job failed: \`${cronName}\`**\n\n${errorMsg}${context ? `\n\nContext: ${JSON.stringify(context, null, 2).slice(0, 500)}` : ''}`,
      'alert'
    )
  } catch (proactiveErr) {
    console.error('[cron-alerting] Proactive message failed:', proactiveErr)
  }
}
