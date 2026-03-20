/**
 * Activity logging utility for Crosby.
 *
 * All functions are fire-and-forget — never await them from call sites.
 * If an insert fails, it fails silently. Logging must never block the main path.
 *
 * Usage:
 *   void logChatMessage({ ... })
 *   void logCronJob({ ... })
 */

import { supabaseAdmin } from '@/lib/supabase'

// --- Payload types ---

export interface ChatMessagePayload {
  conversation_id: string
  model: string
  latency_ms: number
  specialists: string[]
  tools_called: string[]
  from_fallback: boolean
  is_error: boolean
}

export interface CronJobPayload {
  job_name: string
  success: boolean
  duration_ms: number
  summary: string
  metadata?: Record<string, unknown>
}

export interface BackgroundJobPayload {
  job_id: string
  job_type: string
  trigger_source: string
  duration_ms: number
  success: boolean
  error?: string
}

export interface RouterDecisionPayload {
  message_preview: string
  intent: string
  data_needed: string[]
  tools_needed: string[]
  latency_ms: number
  from_fallback: boolean
}

export interface ErrorPayload {
  route: string
  error_type: string
  error_message: string
  context?: Record<string, unknown>
}

export interface NudgeDecisionPayload {
  sent: boolean
  reason: string
  candidate_count: number
}

// --- Log functions ---

function insert(event_type: string, payload: object): void {
  void supabaseAdmin.from('crosby_events').insert({ event_type, payload })
}

export function logChatMessage(payload: ChatMessagePayload): void {
  insert('chat_message', payload)
}

export function logCronJob(payload: CronJobPayload): void {
  insert('cron_job', payload)
}

export function logBackgroundJob(payload: BackgroundJobPayload): void {
  insert('background_job', payload)
}

export function logRouterDecision(payload: RouterDecisionPayload): void {
  insert('router_decision', payload)
}

export function logError(payload: ErrorPayload): void {
  insert('error', payload)
}

export function logNudgeDecision(payload: NudgeDecisionPayload): void {
  insert('nudge_decision', payload)
}
