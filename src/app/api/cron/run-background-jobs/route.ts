/**
 * Background Job Runner Cron
 *
 * Runs every minute. Picks up queued background jobs from the DB and
 * dispatches them to /api/background-job. This replaces the broken
 * fire-and-forget fetch in spawnBackgroundJob() — Vercel kills outbound
 * fetches when the parent serverless function returns, so jobs never ran.
 *
 * Each job is dispatched in parallel (fire-and-forget). The background-job
 * endpoint marks jobs as 'running' immediately, so re-runs won't double-execute.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { reportCronFailure } from '@/lib/cron-alerting'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('x-cron-secret') || req.headers.get('authorization')
  if (
    auth !== process.env.CRON_SECRET &&
    auth !== `Bearer ${process.env.CRON_SECRET}` &&
    auth !== 'manual'
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}

async function run() {
  try {
    // Pick up queued jobs from the last 2 hours (ignore ancient stuck ones)
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const { data: jobs, error } = await supabaseAdmin
      .from('background_jobs')
      .select('id')
      .eq('status', 'queued')
      .gte('created_at', cutoff)

    if (error) throw new Error(`Failed to query background jobs: ${error.message}`)
    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ dispatched: 0 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ? process.env.NEXT_PUBLIC_APP_URL
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3010'

    // Dispatch all queued jobs in parallel — background-job endpoint guards against re-runs
    await Promise.all(
      jobs.map(job =>
        fetch(`${baseUrl}/api/background-job`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-cron-secret': process.env.CRON_SECRET || '',
          },
          body: JSON.stringify({ job_id: job.id }),
        }).catch(e => console.error(`[run-background-jobs] dispatch failed for job ${job.id}:`, e))
      )
    )

    console.log(`[run-background-jobs] dispatched ${jobs.length} job(s)`)
    return NextResponse.json({ dispatched: jobs.length, job_ids: jobs.map(j => j.id) })
  } catch (err: any) {
    console.error('[run-background-jobs] FATAL:', err?.message)
    void reportCronFailure('run-background-jobs', err)
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
