/**
 * Background job infrastructure for Crosby Phase 3.
 * Jobs are async tasks that do work (research, analysis, builds) and write
 * results back to chat as proactive messages.
 */

import { supabaseAdmin } from './supabase'

export type JobType = 'research' | 'analysis' | 'briefing' | 'sop' | 'overnight_build'
export type TriggerSource = 'user' | 'nudge_cron' | 'email_scan' | 'overnight_build' | 'sop_detection'

export interface BackgroundJob {
  id: string
  conversation_id: string
  job_type: JobType
  status: 'queued' | 'running' | 'completed' | 'failed'
  prompt: string
  result: string | null
  trigger_source: TriggerSource | null
  metadata: Record<string, unknown>
  created_at: string
  started_at: string | null
  completed_at: string | null
  error: string | null
}

/**
 * Spawn a background job. Inserts the job into the DB and triggers
 * the background-job endpoint asynchronously (fire-and-forget).
 */
export async function spawnBackgroundJob(
  conversationId: string,
  jobType: JobType,
  prompt: string,
  triggerSource: TriggerSource = 'user',
  metadata: Record<string, unknown> = {}
): Promise<BackgroundJob> {
  const { data: job, error } = await supabaseAdmin
    .from('background_jobs')
    .insert({
      conversation_id: conversationId,
      job_type: jobType,
      status: 'queued',
      prompt,
      trigger_source: triggerSource,
      metadata,
    })
    .select()
    .single()

  if (error || !job) {
    throw new Error(`Failed to create background job: ${error?.message}`)
  }

  // Fire-and-forget: trigger the job endpoint
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3010'

  fetch(`${baseUrl}/api/background-job`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cron-secret': process.env.CRON_SECRET || '',
    },
    body: JSON.stringify({ job_id: job.id }),
  }).catch(e => console.error('Background job trigger failed:', e))

  return job as BackgroundJob
}

/**
 * Check if an auto-trigger is rate-limited.
 * Returns true if the trigger should be skipped (cooldown not elapsed).
 */
export async function isAutoTriggerRateLimited(
  triggerType: string,
  triggerKey: string | null,
  cooldownMs: number
): Promise<boolean> {
  const cutoff = new Date(Date.now() - cooldownMs).toISOString()

  let query = supabaseAdmin
    .from('auto_trigger_log')
    .select('id')
    .eq('trigger_type', triggerType)
    .gte('triggered_at', cutoff)
    .limit(1)

  if (triggerKey) {
    query = query.eq('trigger_key', triggerKey)
  }

  const { data } = await query
  return !!(data && data.length > 0)
}

/**
 * Check global daily cap: max N auto-triggered jobs per day.
 */
export async function getDailyAutoTriggerCount(): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600000).toISOString()
  const { count } = await supabaseAdmin
    .from('auto_trigger_log')
    .select('id', { count: 'exact', head: true })
    .gte('triggered_at', since)

  return count || 0
}

/**
 * Log an auto-trigger event.
 */
export async function logAutoTrigger(
  triggerType: string,
  triggerKey: string | null,
  backgroundJobId: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await supabaseAdmin.from('auto_trigger_log').insert({
    trigger_type: triggerType,
    trigger_key: triggerKey,
    background_job_id: backgroundJobId,
    metadata,
  })
}
