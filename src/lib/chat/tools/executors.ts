import { supabaseAdmin } from '@/lib/supabase'
import { normalizePhone } from '@/lib/phone'
import { searchEmails, createDraft, fetchEmails } from '@/lib/gmail'
import { getConnectedCalendarAccount, fetchUpcomingEvents, createCalendarEvent } from '@/lib/calendar'
import { buildFewShotBlock, storeTrainingExample, getTrainingStats } from '@/lib/training'
import { sendPushToAll } from '@/lib/push'
import { spawnBackgroundJob } from '@/lib/background-jobs'
import { chunkAndEmbedContext } from '@/lib/embed-context'
import { executeWebSearch } from '../web-search'
import type { ActionItem, Artifact, DashboardCard, NotificationRule, Bookmark, UIPreference, Note, Contact } from '@/lib/types'

const JASON_EMAILS_SET = new Set(['jason@hungry.llc', 'jason@demayorestaurantgroup.com', 'jasondemayo@gmail.com'])

export async function executeSearchTexts(input: {
  query?: string
  contact_name?: string
  phone_number?: string
  days_back?: number
  include_outbound?: boolean
}): Promise<object> {
  const daysBack = input.days_back ?? 7
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

  let q = supabaseAdmin
    .from('text_messages')
    .select('contact_name, phone_number, message_text, service, message_date, is_from_me, is_group_chat, group_chat_name, flagged, flag_reason')
    .gte('message_date', cutoff)
    .order('message_date', { ascending: false })
    .limit(25)

  if (!input.include_outbound) q = q.eq('is_from_me', false)
  if (input.query) q = q.ilike('message_text', `%${input.query}%`)
  if (input.phone_number) q = q.eq('phone_number', normalizePhone(input.phone_number))
  if (input.contact_name) q = q.ilike('contact_name', `%${input.contact_name}%`)

  const { data, error } = await q
  if (error) return { error: error.message }
  return { results: data ?? [], count: data?.length ?? 0 }
}

export async function executeManageTextContacts(input: {
  action: 'add_contact' | 'list_contacts' | 'remove_contact'
  phone_number?: string
  name?: string
  role?: string
}): Promise<object> {
  if (input.action === 'list_contacts') {
    const { data, error } = await supabaseAdmin
      .from('text_contacts')
      .select('phone_number, contact_name, role, created_at')
      .order('contact_name', { ascending: true })
    if (error) return { error: error.message }
    return { contacts: data ?? [] }
  }

  if (input.action === 'add_contact') {
    if (!input.phone_number || !input.name) return { error: 'phone_number and name are required' }
    const normalized = normalizePhone(input.phone_number)
    const { error } = await supabaseAdmin
      .from('text_contacts')
      .upsert({ phone_number: normalized, contact_name: input.name, role: input.role ?? null }, { onConflict: 'phone_number' })
    if (error) return { error: error.message }
    // Backfill contact_name on existing messages for this number
    await supabaseAdmin
      .from('text_messages')
      .update({ contact_name: input.name })
      .eq('phone_number', normalized)
    return { ok: true, phone_number: normalized, contact_name: input.name }
  }

  if (input.action === 'remove_contact') {
    if (!input.phone_number) return { error: 'phone_number is required' }
    const normalized = normalizePhone(input.phone_number)
    const { error } = await supabaseAdmin
      .from('text_contacts')
      .delete()
      .eq('phone_number', normalized)
    if (error) return { error: error.message }
    return { ok: true, removed: normalized }
  }

  return { error: 'Unknown action' }
}

export async function executeManageGroupWhitelist(input: {
  action: 'add_group' | 'list_groups' | 'remove_group' | 'list_available_groups'
  chat_identifier?: string
  display_name?: string
}): Promise<object> {
  if (input.action === 'list_groups') {
    const { data, error } = await supabaseAdmin
      .from('text_group_whitelist')
      .select('chat_identifier, display_name, created_at')
      .order('display_name', { ascending: true })
    if (error) return { error: error.message }
    return { groups: data ?? [] }
  }

  if (input.action === 'list_available_groups') {
    const { data: whitelisted } = await supabaseAdmin
      .from('text_group_whitelist')
      .select('chat_identifier')
    const whitelistedIds = new Set((whitelisted ?? []).map((r: { chat_identifier: string }) => r.chat_identifier))

    const { data, error } = await supabaseAdmin
      .from('text_messages')
      .select('chat_identifier, group_chat_name')
      .eq('is_group_chat', true)
      .not('chat_identifier', 'is', null)
      .order('message_date', { ascending: false })
      .limit(500)
    if (error) return { error: error.message }

    const seen = new Map<string, string | null>()
    for (const r of (data ?? [])) {
      if (r.chat_identifier && !whitelistedIds.has(r.chat_identifier) && !seen.has(r.chat_identifier)) {
        seen.set(r.chat_identifier, r.group_chat_name)
      }
    }
    return {
      available_groups: Array.from(seen.entries()).map(([id, name]) => ({ chat_identifier: id, group_chat_name: name })),
      note: 'Use add_group with a chat_identifier and display_name to whitelist one of these.',
    }
  }

  if (input.action === 'add_group') {
    if (!input.chat_identifier || !input.display_name) return { error: 'chat_identifier and display_name are required' }
    const { error } = await supabaseAdmin
      .from('text_group_whitelist')
      .upsert({ chat_identifier: input.chat_identifier, display_name: input.display_name }, { onConflict: 'chat_identifier' })
    if (error) return { error: error.message }
    return { ok: true, whitelisted: input.chat_identifier, display_name: input.display_name }
  }

  if (input.action === 'remove_group') {
    if (!input.chat_identifier) return { error: 'chat_identifier is required' }
    const { error } = await supabaseAdmin
      .from('text_group_whitelist')
      .delete()
      .eq('chat_identifier', input.chat_identifier)
    if (error) return { error: error.message }
    return { ok: true, removed: input.chat_identifier }
  }

  return { error: 'Unknown action' }
}

export async function executeCheckCalendar(input: any): Promise<any> {
  const account = await getConnectedCalendarAccount()
  if (!account) return { error: 'No calendar account connected.' }

  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 24 * 3600000).toISOString().split('T')[0]
  const startDate = input.start_date || today
  const endDate = input.end_date || tomorrow

  const timeMin = `${startDate}T00:00:00-07:00`
  const timeMax = `${endDate}T23:59:59-07:00`

  const events = await fetchUpcomingEvents(account, timeMin, timeMax)

  // Apply text filter if provided
  let filtered = events
  if (input.query) {
    const q = input.query.toLowerCase()
    filtered = events.filter(e =>
      (e.title || '').toLowerCase().includes(q) ||
      (e.description || '').toLowerCase().includes(q) ||
      e.attendees.some(a => (a.name || '').toLowerCase().includes(q) || a.email.toLowerCase().includes(q))
    )
  }

  if (filtered.length === 0) {
    return { message: `No events found between ${startDate} and ${endDate}${input.query ? ` matching "${input.query}"` : ''}.`, events: [] }
  }

  const formatted = filtered.map(e => {
    const attendeeNames = e.attendees
      .filter(a => !JASON_EMAILS_SET.has(a.email.toLowerCase()))
      .map(a => a.name?.split(' ')[0] || a.email)
    return {
      title: e.title,
      start: e.startTime,
      end: e.endTime,
      all_day: e.allDay,
      location: e.location,
      attendees: attendeeNames,
      status: e.status,
    }
  })

  return { events: formatted, count: formatted.length }
}

export async function executeFindAvailability(input: any): Promise<any> {
  const account = await getConnectedCalendarAccount()
  if (!account) return { error: 'No calendar account connected.' }

  const date = input.date
  const minDuration = input.min_duration_minutes || 30
  const startHour = input.start_hour ?? 9
  const endHour = input.end_hour ?? 17

  const timeMin = `${date}T00:00:00-07:00`
  const timeMax = `${date}T23:59:59-07:00`

  const events = await fetchUpcomingEvents(account, timeMin, timeMax)

  // Build busy blocks (in minutes from midnight PT)
  const busy: { start: number; end: number; title: string }[] = []
  for (const e of events) {
    if (e.status === 'cancelled') continue
    if (e.allDay) {
      // All-day events block the whole day
      busy.push({ start: startHour * 60, end: endHour * 60, title: e.title })
      continue
    }
    if (!e.startTime || !e.endTime) continue
    const s = new Date(e.startTime)
    const eEnd = new Date(e.endTime)
    const sMin = s.getHours() * 60 + s.getMinutes()
    const eMin = eEnd.getHours() * 60 + eEnd.getMinutes()
    busy.push({ start: sMin, end: eMin, title: e.title })
  }

  // Sort by start time
  busy.sort((a, b) => a.start - b.start)

  // Find gaps
  const slots: { start: string; end: string; duration_minutes: number }[] = []
  let cursor = startHour * 60

  for (const block of busy) {
    if (block.start > cursor) {
      const gap = block.start - cursor
      if (gap >= minDuration) {
        slots.push({
          start: `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`,
          end: `${String(Math.floor(block.start / 60)).padStart(2, '0')}:${String(block.start % 60).padStart(2, '0')}`,
          duration_minutes: gap,
        })
      }
    }
    cursor = Math.max(cursor, block.end)
  }

  // Final gap after last event
  if (cursor < endHour * 60) {
    const gap = endHour * 60 - cursor
    if (gap >= minDuration) {
      slots.push({
        start: `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`,
        end: `${String(Math.floor((endHour * 60) / 60)).padStart(2, '0')}:${String((endHour * 60) % 60).padStart(2, '0')}`,
        duration_minutes: gap,
      })
    }
  }

  if (slots.length === 0) {
    return { message: `No available slots on ${date} (${startHour}am-${endHour > 12 ? endHour - 12 + 'pm' : endHour + 'am'}) with at least ${minDuration} minutes.`, slots: [] }
  }

  return {
    date,
    available_slots: slots,
    total_free_minutes: slots.reduce((sum, s) => sum + s.duration_minutes, 0),
    meetings_count: events.filter(e => e.status !== 'cancelled').length,
  }
}

export async function executeCreateCalendarEvent(input: any): Promise<any> {
  const account = await getConnectedCalendarAccount()
  if (!account) return { error: 'No calendar account connected.' }

  const event = await createCalendarEvent(account, {
    title: input.title,
    startTime: input.start_time,
    endTime: input.end_time,
    description: input.description,
    location: input.location,
    attendees: input.attendees,
  })

  const attendeeNames = event.attendees
    .filter(a => !JASON_EMAILS_SET.has(a.email.toLowerCase()))
    .map(a => a.name?.split(' ')[0] || a.email)

  return {
    message: `Event "${event.title}" created.`,
    event: {
      title: event.title,
      start: event.startTime,
      end: event.endTime,
      location: event.location,
      attendees: attendeeNames,
    },
  }
}

export async function executeQuerySales(input: any): Promise<any> {
  const today = new Date().toISOString().split('T')[0]
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString().split('T')[0]
  const startDate = input.start_date || sevenDaysAgo
  const endDate = input.end_date || today

  let query = supabaseAdmin
    .from('sales_data')
    .select('store_number, store_name, brand, report_date, net_sales, forecast_sales, budget_sales')
    .gte('report_date', startDate)
    .lte('report_date', endDate)
    .order('report_date', { ascending: false })

  if (input.store_number) query = query.eq('store_number', input.store_number)
  if (input.brand) query = query.eq('brand', input.brand)

  const { data, error } = await query

  if (error) return { status: 'error', message: error.message }
  if (!data || data.length === 0) return { status: 'ok', message: `No sales data found between ${startDate} and ${endDate}.`, rows: [] }

  return { status: 'ok', start_date: startDate, end_date: endDate, rows: data }
}

export async function executeActionItemTool(
  input: { operation: string; title?: string; description?: string; priority?: string; due_date?: string; item_id?: string },
  conversationId: string,
  existingItems: ActionItem[],
): Promise<{ status: string; item?: ActionItem; items?: ActionItem[]; message?: string }> {
  switch (input.operation) {
    case 'create': {
      if (!input.title) return { status: 'error', message: 'Title is required' }

      // Dedup check: keyword match against existing items
      const titleWords = input.title.toLowerCase().split(/\s+/).filter(w => w.length > 3)
      const duplicate = existingItems.find(item => {
        const existingWords = item.title.toLowerCase().split(/\s+/)
        const matches = titleWords.filter(w => existingWords.some(ew => ew.includes(w) || w.includes(ew)))
        return matches.length >= Math.min(2, titleWords.length)
      })

      if (duplicate) {
        return {
          status: 'duplicate',
          item: duplicate,
          message: `Similar item already exists: "${duplicate.title}" (${duplicate.status}). Consider updating it instead.`,
        }
      }

      const { data, error } = await supabaseAdmin
        .from('action_items')
        .insert({
          title: input.title,
          description: input.description || null,
          source: 'chat',
          source_id: conversationId,
          status: 'approved',
          priority: input.priority || 'medium',
          due_date: input.due_date || null,
        })
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }

      // Implicit training: record positive example if item has description context
      if (input.description && input.description.length > 20) {
        storeTrainingExample(input.description, true, 'implicit', 'chat', undefined, data.id)
          .catch(e => console.error('Implicit training (create) failed:', e))
      }

      // Push notification for new action items
      sendPushToAll('New Action Item', input.title, '/dashboard')
        .catch(e => console.error('Push notification failed:', e))

      return { status: 'created', item: data }
    }

    case 'complete': {
      if (!input.item_id) return { status: 'error', message: 'item_id is required' }

      const { data, error } = await supabaseAdmin
        .from('action_items')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', input.item_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'completed', item: data }
    }

    case 'update': {
      if (!input.item_id) return { status: 'error', message: 'item_id is required' }

      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      if (input.title) updates.title = input.title
      if (input.description !== undefined) updates.description = input.description
      if (input.priority) updates.priority = input.priority
      if (input.due_date) updates.due_date = input.due_date

      const { data, error } = await supabaseAdmin
        .from('action_items')
        .update(updates)
        .eq('id', input.item_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'updated', item: data }
    }

    case 'dismiss': {
      if (!input.item_id) return { status: 'error', message: 'item_id is required' }

      const dismissUpdate: Record<string, any> = { status: 'dismissed', updated_at: new Date().toISOString() }
      if ((input as any).dismissal_reason) dismissUpdate.dismissal_reason = (input as any).dismissal_reason

      const { data, error } = await supabaseAdmin
        .from('action_items')
        .update(dismissUpdate)
        .eq('id', input.item_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }

      // Implicit training: record negative example if item has a source snippet
      if (data.source_snippet) {
        storeTrainingExample(data.source_snippet, false, 'implicit', data.source || undefined, undefined, data.id)
          .catch(e => console.error('Implicit training (dismiss) failed:', e))
      }

      return { status: 'dismissed', item: data }
    }

    case 'snooze': {
      if (!input.item_id) return { status: 'error', message: 'item_id is required' }

      const snoozeUntil = input.due_date
        ? new Date(input.due_date).toISOString()
        : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

      const { data, error } = await supabaseAdmin
        .from('action_items')
        .update({ snoozed_until: snoozeUntil, updated_at: new Date().toISOString() })
        .eq('id', input.item_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'snoozed', item: data, message: `Snoozed until ${new Date(snoozeUntil).toLocaleDateString()}` }
    }

    case 'list': {
      const { data } = await supabaseAdmin
        .from('action_items')
        .select('*')
        .in('status', ['pending', 'approved'])
        .or('snoozed_until.is.null,snoozed_until.lte.' + new Date().toISOString())
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(30)

      return { status: 'ok', items: data || [] }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

export async function executeArtifactTool(
  input: { operation: string; artifact_id?: string; name?: string; content?: string; type?: string },
  conversationId: string,
  projectId?: string | null,
): Promise<{ status: string; artifact?: Artifact; message?: string }> {
  if (input.operation === 'create') {
    if (!input.name || !input.content) return { status: 'error', message: 'Name and content are required' }

    const { data, error } = await supabaseAdmin
      .from('artifacts')
      .insert({
        name: input.name,
        content: input.content,
        type: input.type || 'freeform',
        conversation_id: conversationId,
        project_id: projectId || null,
        version: 1,
      })
      .select()
      .single()

    if (error) return { status: 'error', message: error.message }

    // Insert version 1
    await supabaseAdmin.from('artifact_versions').insert({
      artifact_id: data.id,
      content: input.content,
      version: 1,
      change_summary: 'Initial version',
      changed_by: 'assistant',
    })

    return { status: 'created', artifact: data }
  }

  if (input.operation === 'update') {
    if (!input.artifact_id) return { status: 'error', message: 'artifact_id is required for update' }
    if (!input.content) return { status: 'error', message: 'content is required for update' }

    // Get current to snapshot
    const { data: current } = await supabaseAdmin.from('artifacts').select('*').eq('id', input.artifact_id).single()
    if (!current) return { status: 'error', message: 'Artifact not found' }

    // Snapshot old version
    await supabaseAdmin.from('artifact_versions').insert({
      artifact_id: input.artifact_id,
      content: current.content,
      version: current.version,
      change_summary: null,
      changed_by: 'assistant',
    })

    const updates: Record<string, any> = {
      content: input.content,
      version: current.version + 1,
      updated_at: new Date().toISOString(),
    }
    if (input.name) updates.name = input.name
    if (input.type) updates.type = input.type

    const { data, error } = await supabaseAdmin
      .from('artifacts')
      .update(updates)
      .eq('id', input.artifact_id)
      .select()
      .single()

    if (error) return { status: 'error', message: error.message }
    return { status: 'updated', artifact: data }
  }

  return { status: 'error', message: `Unknown operation: ${input.operation}` }
}

export async function executeManageProjectContext(
  input: { operation: string; project_name: string; context_id?: string; summary_title?: string; summary_content?: string },
): Promise<{ status: string; project_name?: string; project_id?: string; context_id?: string; message?: string }> {
  // Find project by fuzzy name match
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id, name')
    .ilike('name', `%${input.project_name}%`)
    .limit(5)

  if (!projects || projects.length === 0) {
    return { status: 'error', message: `No project found matching "${input.project_name}"` }
  }
  const project = projects[0]

  switch (input.operation) {
    case 'list': {
      const { data: entries, error } = await supabaseAdmin
        .from('project_context')
        .select('id, title, content, created_at, updated_at')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })

      if (error) return { status: 'error', message: error.message }

      const items = (entries || []).map(e => ({
        context_id: e.id,
        title: e.title,
        content: e.content,
        created_at: e.created_at,
        updated_at: e.updated_at,
      }))

      return { status: 'listed', project_name: project.name, project_id: project.id, entries: items } as any
    }

    case 'create': {
      if (!input.summary_title || !input.summary_content) {
        return { status: 'error', message: 'summary_title and summary_content are required for create' }
      }

      const { data: ctx, error } = await supabaseAdmin
        .from('project_context')
        .insert({
          project_id: project.id,
          title: input.summary_title,
          content: input.summary_content,
        })
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }

      // Background: chunk and embed
      chunkAndEmbedContext(ctx.id, input.summary_content).catch(console.error)

      return { status: 'created', project_name: project.name, project_id: project.id, context_id: ctx.id }
    }

    case 'update': {
      if (!input.context_id) return { status: 'error', message: 'context_id is required for update' }
      if (!input.summary_content) return { status: 'error', message: 'summary_content is required for update' }

      const update: Record<string, any> = {
        content: input.summary_content,
        updated_at: new Date().toISOString(),
      }
      if (input.summary_title) update.title = input.summary_title

      const { data: ctx, error } = await supabaseAdmin
        .from('project_context')
        .update(update)
        .eq('id', input.context_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }

      // Re-chunk and re-embed with updated content
      chunkAndEmbedContext(ctx.id, ctx.content).catch(console.error)

      return { status: 'updated', project_name: project.name, project_id: project.id, context_id: ctx.id }
    }

    case 'archive': {
      if (!input.context_id) return { status: 'error', message: 'context_id is required for archive' }

      // Delete the context entry and its chunks (cascade handles chunks)
      const { error } = await supabaseAdmin
        .from('project_context')
        .delete()
        .eq('id', input.context_id)

      if (error) return { status: 'error', message: error.message }

      return { status: 'archived', project_name: project.name, project_id: project.id, context_id: input.context_id }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

export async function executeProjectTool(
  input: { operation: string; name: string; new_name?: string; description?: string; color?: string; system_prompt?: string },
): Promise<{ status: string; project?: any; message?: string }> {
  switch (input.operation) {
    case 'create': {
      const { data, error } = await supabaseAdmin
        .from('projects')
        .insert({
          name: input.name,
          description: input.description || null,
          color: input.color || '#3B82F6',
          system_prompt: input.system_prompt || null,
        })
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'created', project: data }
    }

    case 'update': {
      const { data: projects } = await supabaseAdmin
        .from('projects')
        .select('*')
        .ilike('name', `%${input.name}%`)
        .limit(5)

      if (!projects || projects.length === 0) {
        return { status: 'error', message: `No project found matching "${input.name}"` }
      }
      const project = projects[0]

      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      if (input.new_name) updates.name = input.new_name
      if (input.description !== undefined) updates.description = input.description
      if (input.color) updates.color = input.color
      if (input.system_prompt !== undefined) updates.system_prompt = input.system_prompt

      const { data, error } = await supabaseAdmin
        .from('projects')
        .update(updates)
        .eq('id', project.id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'updated', project: data }
    }

    case 'archive': {
      const { data: projects } = await supabaseAdmin
        .from('projects')
        .select('id, name')
        .ilike('name', `%${input.name}%`)
        .limit(5)

      if (!projects || projects.length === 0) {
        return { status: 'error', message: `No project found matching "${input.name}"` }
      }
      const project = projects[0]

      const { error } = await supabaseAdmin
        .from('projects')
        .delete()
        .eq('id', project.id)

      if (error) return { status: 'error', message: error.message }
      return { status: 'archived', project: { id: project.id, name: project.name } }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

export async function executeBookmarkTool(
  input: { operation: string; project_name: string; url?: string; title?: string; description?: string; bookmark_id?: string },
): Promise<{ status: string; bookmark?: Bookmark; bookmarks?: Bookmark[]; message?: string }> {
  // Find project by fuzzy name
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id, name')
    .ilike('name', `%${input.project_name}%`)
    .limit(5)

  if (!projects || projects.length === 0) {
    return { status: 'error', message: `No project found matching "${input.project_name}"` }
  }
  const project = projects[0]

  switch (input.operation) {
    case 'create': {
      if (!input.url || !input.title) return { status: 'error', message: 'url and title are required' }

      const { data, error } = await supabaseAdmin
        .from('bookmarks')
        .insert({
          project_id: project.id,
          url: input.url,
          title: input.title,
          description: input.description || null,
        })
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'created', bookmark: data }
    }

    case 'list': {
      const { data } = await supabaseAdmin
        .from('bookmarks')
        .select('*')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })

      return { status: 'ok', bookmarks: data || [] }
    }

    case 'delete': {
      if (!input.bookmark_id) return { status: 'error', message: 'bookmark_id is required' }

      const { error } = await supabaseAdmin
        .from('bookmarks')
        .delete()
        .eq('id', input.bookmark_id)

      if (error) return { status: 'error', message: error.message }
      return { status: 'deleted' }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

export async function executeDashboardCardTool(
  input: { operation: string; card_id?: string; title?: string; content?: string; card_type?: string },
): Promise<{ status: string; card?: DashboardCard; message?: string }> {
  switch (input.operation) {
    case 'create': {
      if (!input.title || !input.content) return { status: 'error', message: 'title and content are required' }

      // Get next position
      const { data: existing } = await supabaseAdmin
        .from('dashboard_cards')
        .select('position')
        .eq('is_active', true)
        .order('position', { ascending: false })
        .limit(1)

      const nextPos = existing && existing.length > 0 ? existing[0].position + 1 : 0

      const { data, error } = await supabaseAdmin
        .from('dashboard_cards')
        .insert({
          title: input.title,
          content: input.content,
          card_type: input.card_type || 'summary',
          position: nextPos,
        })
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'created', card: data }
    }

    case 'update': {
      if (!input.card_id) return { status: 'error', message: 'card_id is required' }

      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      if (input.title) updates.title = input.title
      if (input.content) updates.content = input.content
      if (input.card_type) updates.card_type = input.card_type

      const { data, error } = await supabaseAdmin
        .from('dashboard_cards')
        .update(updates)
        .eq('id', input.card_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'updated', card: data }
    }

    case 'remove': {
      if (!input.card_id) return { status: 'error', message: 'card_id is required' }

      const { error } = await supabaseAdmin
        .from('dashboard_cards')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', input.card_id)

      if (error) return { status: 'error', message: error.message }
      return { status: 'removed' }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

export async function executeNotificationRuleTool(
  input: { operation: string; rule_id?: string; description?: string; match_type?: string; match_value?: string; match_field?: string },
): Promise<{ status: string; rule?: NotificationRule; rules?: NotificationRule[]; message?: string }> {
  switch (input.operation) {
    case 'create': {
      if (!input.description || !input.match_type || !input.match_value) {
        return { status: 'error', message: 'description, match_type, and match_value are required' }
      }

      const { data, error } = await supabaseAdmin
        .from('notification_rules')
        .insert({
          description: input.description,
          match_type: input.match_type,
          match_value: input.match_value,
          match_field: input.match_field || 'any',
        })
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'created', rule: data }
    }

    case 'list': {
      const { data } = await supabaseAdmin
        .from('notification_rules')
        .select('*')
        .order('created_at', { ascending: false })

      return { status: 'ok', rules: data || [] }
    }

    case 'delete': {
      if (!input.rule_id) return { status: 'error', message: 'rule_id is required' }

      const { error } = await supabaseAdmin
        .from('notification_rules')
        .delete()
        .eq('id', input.rule_id)

      if (error) return { status: 'error', message: error.message }
      return { status: 'deleted' }
    }

    case 'toggle': {
      if (!input.rule_id) return { status: 'error', message: 'rule_id is required' }

      const { data: current } = await supabaseAdmin
        .from('notification_rules')
        .select('is_active')
        .eq('id', input.rule_id)
        .single()

      if (!current) return { status: 'error', message: 'Rule not found' }

      const { data, error } = await supabaseAdmin
        .from('notification_rules')
        .update({ is_active: !current.is_active })
        .eq('id', input.rule_id)
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: data.is_active ? 'enabled' : 'disabled', rule: data }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

export async function executePreferencesTool(
  input: { operation: string; key?: string; value?: string },
): Promise<{ status: string; value?: string; preferences?: UIPreference[]; message?: string }> {
  const validKeys = ['sidebar_collapsed', 'accent_color']

  switch (input.operation) {
    case 'set': {
      if (!input.key || input.value === undefined) return { status: 'error', message: 'key and value are required' }
      if (!validKeys.includes(input.key)) return { status: 'error', message: `Invalid key. Valid keys: ${validKeys.join(', ')}` }

      const { data, error } = await supabaseAdmin
        .from('ui_preferences')
        .upsert(
          { key: input.key, value: input.value, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        )
        .select()
        .single()

      if (error) return { status: 'error', message: error.message }
      return { status: 'set', value: data.value }
    }

    case 'get': {
      if (!input.key) return { status: 'error', message: 'key is required' }

      const { data } = await supabaseAdmin
        .from('ui_preferences')
        .select('*')
        .eq('key', input.key)
        .single()

      if (!data) return { status: 'not_set', message: `No preference set for "${input.key}"` }
      return { status: 'ok', value: data.value }
    }

    case 'list': {
      const { data } = await supabaseAdmin
        .from('ui_preferences')
        .select('*')
        .order('key')

      return { status: 'ok', preferences: data || [] }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

export async function executeTrainingTool(
  input: { operation: string; snippet?: string; is_action_item?: boolean; source_type?: string; action_item_id?: string },
): Promise<any> {
  switch (input.operation) {
    case 'teach_me': {
      try {
        // Reuse the teach-me logic: fetch recent emails and build snippets
        const { data: tokenRow } = await supabaseAdmin
          .from('google_tokens')
          .select('account')
          .limit(1)
          .single()

        if (!tokenRow) {
          return { status: 'no_gmail', message: 'No Gmail account connected', snippets: [] }
        }

        const since = new Date(Date.now() - 3 * 24 * 3600000)
        const emails = await fetchEmails(tokenRow.account, since)

        if (emails.length === 0) {
          return { status: 'no_emails', message: 'No recent emails found', snippets: [] }
        }

        const { data: existingItems } = await supabaseAdmin
          .from('action_items')
          .select('source_id')
          .eq('source', 'email')
          .not('source_id', 'is', null)

        const flaggedEmailIds = new Set((existingItems || []).map((i: any) => i.source_id))

        const snippets = emails.slice(0, 20).map(email => ({
          text: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body.slice(0, 500)}`,
          source_type: 'email' as const,
          has_action_item: flaggedEmailIds.has(email.id),
          metadata: { email_id: email.id, subject: email.subject, from: email.from },
        }))

        const shuffled = snippets.sort(() => Math.random() - 0.5).slice(0, 10)
        return { status: 'ok', snippets: shuffled }
      } catch (e: any) {
        return { status: 'error', message: e.message || 'Failed to load snippets', snippets: [] }
      }
    }

    case 'label': {
      if (!input.snippet || input.is_action_item === undefined) {
        return { status: 'error', message: 'snippet and is_action_item are required' }
      }

      try {
        const result = await storeTrainingExample(
          input.snippet,
          input.is_action_item,
          'feedback',
          (input.source_type as 'email' | 'chat') || undefined,
          undefined,
          input.action_item_id,
        )
        return { status: 'labeled', id: result.id, is_action_item: input.is_action_item }
      } catch (e: any) {
        return { status: 'error', message: e.message }
      }
    }

    case 'stats': {
      try {
        const stats = await getTrainingStats()
        return { status: 'ok', ...stats }
      } catch (e: any) {
        return { status: 'error', message: e.message }
      }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

export async function executeNotepadTool(
  input: { operation: string; content?: string; title?: string; note_id?: string },
): Promise<{ status: string; note?: Note; notes?: Note[]; message?: string }> {
  switch (input.operation) {
    case 'create': {
      if (!input.content) return { status: 'error', message: 'content is required' }

      // Dedup check: skip if a similar note already exists
      const { data: existing } = await supabaseAdmin
        .from('notes')
        .select('id, content, title')
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())

      const isDuplicate = existing?.some(n => {
        const sameContent = n.content.toLowerCase().trim().slice(0, 80) === input.content!.toLowerCase().trim().slice(0, 80)
        const sameTitle = input.title && n.title && n.title.toLowerCase() === input.title.toLowerCase()
        return sameContent || sameTitle
      })

      if (isDuplicate) return { status: 'duplicate', message: 'A similar note already exists.' }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabaseAdmin
        .from('notes')
        .insert({ content: input.content, title: input.title || null, expires_at: expiresAt })
        .select()
        .single()
      if (error) return { status: 'error', message: error.message }
      return { status: 'created', note: data }
    }

    case 'list': {
      const { data } = await supabaseAdmin
        .from('notes')
        .select('*')
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
        .order('created_at', { ascending: false })
      return { status: 'ok', notes: data || [] }
    }

    case 'delete': {
      if (!input.note_id) return { status: 'error', message: 'note_id is required' }
      const { error } = await supabaseAdmin.from('notes').delete().eq('id', input.note_id)
      if (error) return { status: 'error', message: error.message }
      return { status: 'deleted' }
    }

    case 'pin': {
      if (!input.note_id) return { status: 'error', message: 'note_id is required' }
      const { data, error } = await supabaseAdmin
        .from('notes')
        .update({ expires_at: null, updated_at: new Date().toISOString() })
        .eq('id', input.note_id)
        .select()
        .single()
      if (error) return { status: 'error', message: error.message }
      return { status: 'pinned', note: data }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

export async function executeContactsTool(
  input: { operation: string; contact_id?: string; name?: string; email?: string; phone?: string; role?: string; organization?: string; notes?: string; query?: string },
): Promise<{ status: string; contact?: Contact; contacts?: Contact[]; message?: string }> {
  switch (input.operation) {
    case 'create': {
      if (!input.name) return { status: 'error', message: 'name is required' }
      const { data, error } = await supabaseAdmin
        .from('contacts')
        .insert({
          name: input.name,
          email: input.email || null,
          phone: input.phone || null,
          role: input.role || null,
          organization: input.organization || null,
          notes: input.notes || null,
        })
        .select()
        .single()
      if (error) return { status: 'error', message: error.message }
      return { status: 'created', contact: data }
    }

    case 'update': {
      if (!input.contact_id) return { status: 'error', message: 'contact_id is required' }
      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      if (input.name !== undefined) updates.name = input.name
      if (input.email !== undefined) updates.email = input.email
      if (input.phone !== undefined) updates.phone = input.phone
      if (input.role !== undefined) updates.role = input.role
      if (input.organization !== undefined) updates.organization = input.organization
      if (input.notes !== undefined) updates.notes = input.notes
      const { data, error } = await supabaseAdmin
        .from('contacts')
        .update(updates)
        .eq('id', input.contact_id)
        .select()
        .single()
      if (error) return { status: 'error', message: error.message }
      return { status: 'updated', contact: data }
    }

    case 'delete': {
      if (!input.contact_id) return { status: 'error', message: 'contact_id is required' }
      const { error } = await supabaseAdmin.from('contacts').delete().eq('id', input.contact_id)
      if (error) return { status: 'error', message: error.message }
      return { status: 'deleted' }
    }

    case 'search': {
      if (!input.query) return { status: 'error', message: 'query is required' }
      const { data } = await supabaseAdmin
        .from('contacts')
        .select('*')
        .or(`name.ilike.%${input.query}%,email.ilike.%${input.query}%,organization.ilike.%${input.query}%`)
        .order('name')
      return { status: 'ok', contacts: data || [] }
    }

    default:
      return { status: 'error', message: `Unknown operation: ${input.operation}` }
  }
}

export async function executeCreateWatch(input: {
  watch_type: string
  description: string
  keywords?: string[]
  sender_email?: string
  sender_domain?: string
  priority?: string
}): Promise<{ status: string; watch?: any; message?: string }> {
  const matchCriteria: Record<string, any> = {
    semantic_context: input.description,
  }

  if (input.keywords && input.keywords.length > 0) {
    matchCriteria.keywords = input.keywords
  }
  if (input.sender_email) {
    matchCriteria.sender_email = input.sender_email.toLowerCase()
  }
  if (input.sender_domain) {
    matchCriteria.sender_domain = input.sender_domain.toLowerCase()
  }
  // Extract domain from sender_email if domain not provided
  if (input.sender_email && !input.sender_domain) {
    const domainMatch = input.sender_email.match(/@(.+)/)
    if (domainMatch) matchCriteria.sender_domain = domainMatch[1].toLowerCase()
  }

  const { data, error } = await supabaseAdmin
    .from('conversation_watches')
    .insert({
      watch_type: input.watch_type,
      match_criteria: matchCriteria,
      context: input.description,
      priority: input.priority || 'normal',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single()

  if (error) return { status: 'error', message: error.message }
  return { status: 'created', watch: data, message: `Watch created: monitoring for ${input.description}` }
}

export async function executeListWatches(): Promise<{ status: string; watches?: any[]; message?: string }> {
  const { data, error } = await supabaseAdmin
    .from('conversation_watches')
    .select('*')
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return { status: 'error', message: error.message }

  const watches = (data || []).map(w => ({
    id: w.id,
    type: w.watch_type,
    context: w.context,
    priority: w.priority,
    created_at: w.created_at,
    expires_at: w.expires_at,
    keywords: w.match_criteria?.keywords || [],
    sender_email: w.match_criteria?.sender_email || null,
    sender_domain: w.match_criteria?.sender_domain || null,
  }))

  return { status: 'ok', watches }
}

export async function executeCancelWatch(input: { watch_id: string }): Promise<{ status: string; message?: string }> {
  if (!input.watch_id) return { status: 'error', message: 'watch_id is required' }

  const { error } = await supabaseAdmin
    .from('conversation_watches')
    .update({ status: 'expired' })
    .eq('id', input.watch_id)

  if (error) return { status: 'error', message: error.message }
  return { status: 'cancelled', message: 'Watch cancelled' }
}

// Re-export for backward compatibility within this module
export { executeWebSearch }

export async function executeSearchConversationHistory(
  input: { query: string },
  conversationId: string,
): Promise<{ status: string; results?: { content: string; role: string; similarity: number }[]; message?: string }> {
  if (!input.query) return { status: 'error', message: 'query is required' }

  try {
    const { generateQueryEmbedding } = await import('@/lib/embeddings')
    const embedding = await generateQueryEmbedding(input.query)

    const { data, error } = await supabaseAdmin.rpc('search_message_embeddings', {
      query_embedding: embedding,
      conversation_id_filter: conversationId,
      match_threshold: 0.5,
      match_count: 8,
    })

    if (error) {
      console.error('[search_conversation_history] RPC error:', error)
      return { status: 'error', message: error.message }
    }

    const results = (data || []).map((row: any) => ({
      content: row.content,
      role: row.role || 'unknown',
      similarity: row.similarity,
    }))

    return { status: 'ok', results }
  } catch (err: any) {
    console.error('[search_conversation_history] failed:', err)
    return { status: 'error', message: err.message }
  }
}

export async function executeGetActivityLog(input: {
  event_types?: string[]
  hours_back?: number
  limit?: number
}): Promise<object> {
  const hoursBack = Math.min(input.hours_back ?? 24, 168)
  const limitCount = Math.min(input.limit ?? 50, 200)
  const cutoff = new Date(Date.now() - hoursBack * 3600000).toISOString()

  let q = supabaseAdmin
    .from('crosby_events')
    .select('event_type, occurred_at, payload')
    .gte('occurred_at', cutoff)
    .order('occurred_at', { ascending: false })
    .limit(limitCount)

  if (input.event_types && input.event_types.length > 0) {
    q = q.in('event_type', input.event_types) as typeof q
  }

  const { data, error } = await q
  if (error) return { error: error.message }

  const lines = (data || []).map(event => {
    const time = new Date(event.occurred_at).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
    const p = event.payload as any

    switch (event.event_type) {
      case 'chat_message':
        return `[${time}] Chat: ${p.specialists?.join(', ') || 'core'} specialists, ${p.tools_called?.length || 0} tools, ${p.latency_ms}ms${p.from_fallback ? ' (fallback router)' : ''}${p.is_error ? ' ERROR' : ''}`
      case 'cron_job':
        return `[${time}] Cron/${p.job_name}: ${p.success ? 'OK' : 'FAILED'} in ${p.duration_ms}ms — ${p.summary}`
      case 'background_job':
        return `[${time}] BgJob/${p.job_type}: ${p.success ? 'OK' : 'FAILED'} in ${p.duration_ms}ms (trigger: ${p.trigger_source})${p.error ? ` — ${p.error}` : ''}`
      case 'router_decision':
        return `[${time}] Router: "${p.message_preview}" → [${p.data_needed?.join(', ') || 'none'}]${p.from_fallback ? ' (fallback)' : ''} ${p.latency_ms}ms`
      case 'error':
        return `[${time}] ERROR in ${p.route}: ${p.error_type} — ${p.error_message}`
      case 'nudge_decision':
        return `[${time}] Nudge: ${p.sent ? 'sent' : 'skipped'} — ${p.reason} (${p.candidate_count} candidates)`
      default:
        return `[${time}] ${event.event_type}: ${JSON.stringify(event.payload).slice(0, 120)}`
    }
  })

  return {
    count: lines.length,
    hours_back: hoursBack,
    events: lines,
    summary: `${lines.length} events in the last ${hoursBack}h`,
  }
}
