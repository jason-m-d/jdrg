import type { ActionItem, Contact } from './types'

const JASON_EMAILS = ['jason@hungry.llc', 'jason@demayorestaurantgroup.com', 'jasondemayo@gmail.com']

export interface CalendarEventEntry {
  title: string
  start_time: string | null
  end_time: string | null
  all_day: boolean
  location: string | null
  attendees: { email: string; name: string | null; responseStatus: string }[]
  organizer_email: string | null
  status: string
}

interface AttendeeContext {
  contactName?: string
  openActionItemCount?: number
}

function formatCalendarSection(
  events: CalendarEventEntry[],
  contacts?: Contact[],
  actionItems?: ActionItem[],
): string {
  if (!events || events.length === 0) return ''

  // Build lookup maps for contacts and action items by email
  const contactByEmail = new Map<string, Contact>()
  if (contacts) {
    for (const c of contacts) {
      if (c.email) contactByEmail.set(c.email.toLowerCase(), c)
    }
  }

  // Count open action items that mention each contact name (simple heuristic)
  const actionItemCountByName = new Map<string, number>()
  if (actionItems && contacts) {
    for (const item of actionItems) {
      const text = `${item.title} ${item.description || ''}`.toLowerCase()
      for (const c of contacts) {
        const firstName = c.name.split(' ')[0].toLowerCase()
        if (firstName.length >= 3 && text.includes(firstName)) {
          actionItemCountByName.set(c.name, (actionItemCountByName.get(c.name) || 0) + 1)
        }
      }
    }
  }

  // Determine "today" and "tomorrow" in Pacific time
  const nowPT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const todayStr = `${nowPT.getFullYear()}-${String(nowPT.getMonth() + 1).padStart(2, '0')}-${String(nowPT.getDate()).padStart(2, '0')}`
  const tomorrowDate = new Date(nowPT)
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrowStr = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`

  const totalEvents = events.length
  const shouldTruncate = totalEvents > 12
  const eventsToShow = shouldTruncate ? events.slice(0, 8) : events

  // Split into all-day and timed, then group by day
  const allDay: CalendarEventEntry[] = []
  const timed: CalendarEventEntry[] = []
  for (const evt of eventsToShow) {
    if (evt.all_day) {
      allDay.push(evt)
    } else {
      timed.push(evt)
    }
  }

  function getDayLabel(dateStr: string | null): string {
    if (!dateStr) return 'Today'
    const date = dateStr.slice(0, 10)
    if (date === todayStr) return 'Today'
    if (date === tomorrowStr) return 'Tomorrow'
    // Fallback: format the date
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })
  }

  function formatTime(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' }).toLowerCase()
  }

  function formatAttendees(attendees: CalendarEventEntry['attendees']): string {
    const names: string[] = []
    for (const a of attendees) {
      if (JASON_EMAILS.includes(a.email.toLowerCase())) continue
      const contact = contactByEmail.get(a.email.toLowerCase())
      let firstName = contact
        ? contact.name.split(' ')[0]
        : (a.name ? a.name.split(' ')[0] : a.email.split('@')[0])
      // Check for action item count
      const fullName = contact?.name
      if (fullName && actionItemCountByName.has(fullName)) {
        firstName += ` (${actionItemCountByName.get(fullName)} open action items)`
      } else if (contact) {
        firstName += ' [contact]'
      }
      names.push(firstName)
    }
    return names.length > 0 ? names.join(', ') : ''
  }

  function formatEvent(evt: CalendarEventEntry): string {
    if (evt.all_day) {
      let line = `All Day: ${evt.title}`
      const attendeeStr = formatAttendees(evt.attendees)
      if (attendeeStr) line += ` (with ${attendeeStr})`
      if (evt.location) line += ` @ ${evt.location}`
      return `- ${line}`
    }
    const start = evt.start_time ? formatTime(evt.start_time) : '?'
    const end = evt.end_time ? formatTime(evt.end_time) : '?'
    let line = `${start}-${end} ${evt.title}`
    const attendeeStr = formatAttendees(evt.attendees)
    if (attendeeStr) line += ` (with ${attendeeStr})`
    if (evt.location) line += ` @ ${evt.location}`
    return `- ${line}`
  }

  // Group events by day
  const dayGroups = new Map<string, CalendarEventEntry[]>()
  for (const evt of allDay) {
    const label = getDayLabel(evt.start_time)
    if (!dayGroups.has(label)) dayGroups.set(label, [])
    dayGroups.get(label)!.push(evt)
  }
  for (const evt of timed) {
    const label = getDayLabel(evt.start_time)
    if (!dayGroups.has(label)) dayGroups.set(label, [])
    dayGroups.get(label)!.push(evt)
  }

  // Ensure "Today" comes first, then "Tomorrow", then others
  const orderedLabels = [...dayGroups.keys()].sort((a, b) => {
    if (a === 'Today') return -1
    if (b === 'Today') return 1
    if (a === 'Tomorrow') return -1
    if (b === 'Tomorrow') return 1
    return 0
  })

  const lines: string[] = []
  for (const label of orderedLabels) {
    lines.push(`**${label}**`)
    for (const evt of dayGroups.get(label)!) {
      lines.push(formatEvent(evt))
    }
  }

  if (shouldTruncate) {
    lines.push(`\n...and ${totalEvents - 8} more events in the next 48 hours`)
  }

  return `\n\n--- Upcoming Calendar ---\n${lines.join('\n')}`
}

export const BASE_SYSTEM_PROMPT = `You are Crosby, the private AI workspace for Jason DeMayo. Jason is CEO of DeMayo Restaurant Group (DRG), operating 8 Wingstop franchise locations in California, and Hungry Hospitality Group (HHG), operating 2 Mr. Pickle's franchise locations.

Wingstop stores:
- 326 (Coleman, San Jose) - 503 Coleman Ave, Ste 40, San Jose, CA 95110
- 451 (Hollenbeck, Sunnyvale) - 1661 Hollenbeck Ave, Ste B, Sunnyvale, CA 94087
- 895 (McKee, San Jose) - 2719 McKee Rd, San Jose, CA 95127
- 1870 (Showers, Mountain View) - 530 Showers Dr, Spc AA08, Mountain View, CA 94040
- 2067 (Aborn, San Jose) - 2752 Aborn Rd, San Jose, CA 95121
- 2262 (Stevens Creek, San Jose) - 5134 Stevens Creek Blvd, San Jose, CA 95129
- 2289 (Prospect, Saratoga) - 18584 Prospect Rd, Saratoga, CA 95070
- 2428 (Winchester, San Jose) - 812 S Winchester Blvd, Ste 110, San Jose, CA 95128

Mr. Pickle's stores:
- 405 (Blackstone, Fresno) - 7967 N Blackstone Ave, Fresno, CA 93720
- 1008 (Sepulveda, Van Nuys) - 7070 Sepulveda Blvd, Van Nuys, CA 91405

Jason's emails: jason@hungry.llc, jason@demayorestaurantgroup.com, jasondemayo@gmail.com

Ownership: DRG is Jason 30% / Woody 70% (passive). HHG is Jason 25% / Eli 25% / Woody 50% (passive).

DECISION DIRECTIVES - evaluate IN ORDER before responding:

1. WEB SEARCH: Does this ask about real-world facts, current events, addresses, hours, prices, people, companies, or anything time-sensitive?
   -> Use web_search BEFORE writing any response text.

2. ARTIFACT: Does this ask to create a document, plan, checklist, spec, or list?
   -> CALL manage_artifact. Do not write content as chat text.

3. PAST CONVERSATIONS: Does this reference past conversations ("remember when", "what did we talk about", "earlier you said")?
   -> CALL search_conversation_history first.

4. SALES DATA: Does this ask about store performance, sales, or revenue?
   -> CALL query_sales. Do not search Gmail for sales data.

5. DRAFT EMAIL: Does this ask to send, draft, or forward an email?
   -> Use quick_confirm, then CALL draft_email.

6. ACTION ITEMS: Does this ask to see, create, or modify action items?
   -> CALL manage_action_items. For "list": the card tracks ARE the response. Write 1-2 sentences of editorial only - do NOT list items as text.

7. EMAIL SEARCH: Does this ask to find or look up specific emails?
   -> CALL search_gmail.

8. CALENDAR: Does this ask about schedule or availability?
   -> Your calendar context is already loaded above. Answer directly from it.
   -> Only call check_calendar if the question is about dates BEYOND your loaded calendar window.
   -> Call find_availability for gap-finding or free time requests.
   -> Call create_calendar_event to add events.

For rules 1-5: call the tool BEFORE generating prose. Multiple rules can apply.

RESPONSE STYLE:
- Do NOT narrate what you're about to do. No "Let me check your calendar", "Looking into that", "Searching your emails". Just do it and respond with what you found.
- When a tool renders UI (card tracks, artifacts, email search results, drafts), that UI IS the response. Write a brief editorial comment only. Do NOT re-list or repeat what the UI shows.
- After mutations (created action item, drafted email, added event), confirm briefly what you did. One sentence.

Be direct, casual, no fluff. Use bullets and clean structure. Never use em dashes - use hyphens or commas instead. Proactively surface action items and follow-ups. You have full context of all uploaded documents and past conversations.

You are more than a chatbot - you are the brain of this app. You can manage action items, draft emails, organize projects, pin dashboard cards, set up email alerts, and learn from feedback. Background processes (email scanning, morning briefings, proactive greetings) also run autonomously. A detailed app manual exists in the documents - relevant sections will surface automatically when needed. Think across features: action items, projects, dashboard cards, notification rules, emails, and documents all work together.

When the user references past conversations ("what did we talk about", "remember when", "earlier you said"), use search_conversation_history to find relevant past messages. This is your memory for things not in the current context window.

TONE & VOICE:
- After confirming a task is done (watch created, email drafted, action item added, etc.), make a brief, natural human comment when context warrants it. Don't just say "Done." - add one sentence that shows you're paying attention to what the thing actually is. Example: "Done. You'll get a push notification if anything comes in about Paul McCartney - hope it's a good show." Keep it short and genuine, not sycophantic.
- When summarizing people and their roles in a situation (e.g. "Eli takes photos, Tim comes Thursday"), bold the person's name for scannability.
- Never say "based on what's loaded in my context" or similar phrases that expose internal mechanics. Just answer the question. If you have a limitation, describe it naturally: "I'm only seeing one event today" not "based on loaded context."

INSIDE vs. OUTSIDE THE APP:
- For actions inside the app (action items, watches, notepad, contacts, projects, dashboard cards) - just do it and tell Jason what you did. He can immediately undo or change anything inside the app. Never ask permission first.
- For actions outside the app that are hard to reverse (sending an email, drafting an email to someone, adding/modifying a calendar event, sending a text) - use quick_confirm or mention it before doing it.

CALENDAR vs. NOTEPAD:
- When Jason shares a scheduled event (meeting, visit, call, deadline), offer to add it to his calendar - not to the notepad. Notepad is for facts and context, not scheduled events.

ARTIFACTS - MANDATORY TOOL USE:
When Jason asks you to create any document, plan, checklist, spec, or list - you MUST call manage_artifact. Do not write the content as text in your response. Call the tool. The side panel displays it automatically. If you write it as text instead of calling the tool, you have failed at your job.`

export interface RecentText {
  contact_name: string | null
  phone_number: string
  message_text: string
  service: string
  message_date: string
  is_from_me: boolean
  is_group_chat: boolean
  group_chat_name: string | null
  flag_reason: string | null
}

export function buildBriefingPrompt(data: {
  salesData: { store_number: string; store_name: string; brand: string; net_sales: number }[]
  actionItems: { title: string; status: string; priority: string; due_date: string | null; description?: string | null }[]
  emailScanStats: { account: string; emails_processed: number; action_items_found: number; last_scanned_at: string }[]
  calendarEvents?: CalendarEventEntry[]
  contacts?: { name: string; email: string | null }[]
}, preferences: string[]): string {
  const parts: string[] = []

  parts.push(`Write a concise morning briefing for Jason DeMayo, CEO of DeMayo Restaurant Group (8 Wingstop locations) and Hungry Hospitality Group (2 Mr. Pickle's locations).

FORMAT:
- Start with 1-2 sentences of natural, direct commentary on the day — what stands out, what's urgent, what's looking good. Sound like a sharp assistant, not a robot. Be specific.
- Then sections by topic using ## headers (## Sales, ## Action Items, ## Calendar, etc.)
- Use bullet points within sections. **Bold the most important entity in each bullet** — store name, vendor, person, amount. Keep bullets tight.
- Example bullet: "- **TLC Power Washing** — 5 unpaid invoices across stores, oldest overdue since 2/01"
- Example bullet: "- **Store #895 (Aborn)** — $5,220 yesterday, 28% below rolling avg"

RULES:
- Under 250 words total
- Skip sections with nothing noteworthy (don't say "No issues" — just omit)
- Use hyphens not em dashes
- One-way notification — no questions, no "let me know"
- Group related items (multiple invoices same vendor = one bullet with count)`)

  if (preferences.length > 0) {
    parts.push(`\n\nUser preferences (MUST respect these - skip topics the user doesn't want, emphasize what they do):
${preferences.map(p => `- ${p}`).join('\n')}`)
  }

  if (data.salesData.length > 0) {
    const wingstopTarget = 8000
    const mpTarget = 3000
    const salesLines = data.salesData.map(s => {
      const target = s.brand === 'wingstop' ? wingstopTarget : mpTarget
      const pct = Math.round((s.net_sales / target) * 100)
      return `- ${s.store_name} (#${s.store_number}): $${s.net_sales.toLocaleString()} (${pct}% of target)`
    })
    parts.push(`\n\nYesterday's Sales:\n${salesLines.join('\n')}`)
  } else {
    parts.push('\n\nYesterday\'s Sales: No data available.')
  }

  if (data.actionItems.length > 0) {
    const overdue = data.actionItems.filter(i => i.due_date && new Date(i.due_date) < new Date())
    const dueToday = data.actionItems.filter(i => i.due_date && i.due_date === new Date().toISOString().split('T')[0])
    const highPriority = data.actionItems.filter(i => i.priority === 'high')

    const lines: string[] = []
    lines.push(`Total pending: ${data.actionItems.length}`)
    if (overdue.length > 0) lines.push(`OVERDUE (${overdue.length}): ${overdue.map(i => i.title).join(', ')}`)
    if (dueToday.length > 0) lines.push(`Due today (${dueToday.length}): ${dueToday.map(i => i.title).join(', ')}`)
    if (highPriority.length > 0) lines.push(`High priority (${highPriority.length}): ${highPriority.map(i => i.title).join(', ')}`)
    parts.push(`\n\nAction Items:\n${lines.map(l => `- ${l}`).join('\n')}`)
  } else {
    parts.push('\n\nAction Items: None pending.')
  }

  if (data.emailScanStats.length > 0) {
    const total = data.emailScanStats.reduce((sum, s) => sum + s.emails_processed, 0)
    const items = data.emailScanStats.reduce((sum, s) => sum + s.action_items_found, 0)
    parts.push(`\n\nEmail Activity (last scan): ${total} emails processed, ${items} action items extracted.`)
  }

  if (data.calendarEvents && data.calendarEvents.length > 0) {
    // Pass contacts and action items for cross-referencing annotations
    const contactsAsContact = (data.contacts || []).map(c => ({ ...c, id: '', phone: null, role: null, organization: null, notes: null, created_at: '', updated_at: '' })) as Contact[]
    const itemsAsActionItem = data.actionItems.map(i => ({ ...i, id: '', description: i.description || null, source: null, source_id: null, source_snippet: null, created_at: '', updated_at: '', snoozed_until: null, confidence: null, last_surfaced_at: null, agent_id: '', dismissal_reason: null, last_nudged_at: null })) as ActionItem[]
    const calSection = formatCalendarSection(data.calendarEvents, contactsAsContact, itemsAsActionItem)
    if (calSection) parts.push(calSection)

    // Calendar analysis instructions for the briefing
    const todayEvents = data.calendarEvents.filter(e => {
      if (!e.start_time) return false
      const nowPT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
      const todayStr = `${nowPT.getFullYear()}-${String(nowPT.getMonth() + 1).padStart(2, '0')}-${String(nowPT.getDate()).padStart(2, '0')}`
      return e.start_time.startsWith(todayStr)
    })

    const tomorrowEvents = data.calendarEvents.filter(e => {
      if (!e.start_time) return false
      const nowPT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
      const tomorrowDate = new Date(nowPT)
      tomorrowDate.setDate(tomorrowDate.getDate() + 1)
      const tomorrowStr = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`
      return e.start_time.startsWith(tomorrowStr)
    })

    parts.push(`\n\nCalendar Analysis (include in briefing):
- Total meetings today: ${todayEvents.length}${todayEvents.length > 0 ? `. First meeting: ${todayEvents[0].title} at ${todayEvents[0].start_time}` : ''}
- Look for back-to-back stretches: 2+ meetings with no gap between them. Flag these so Jason can plan.
- Cross-reference attendees with the action items listed above. If Jason is meeting someone who has open action items, call that out specifically (e.g. "You're meeting Roger at 2pm - you have 2 open items with him").
- If today has 4+ meetings, identify gaps between meetings where Jason could tackle action items.
${tomorrowEvents.length > 0 ? `- Tomorrow heads-up: first meeting is "${tomorrowEvents[0].title}" at ${tomorrowEvents[0].start_time}` : '- No meetings on tomorrow\'s calendar yet.'}`)
  }

  return parts.join('')
}
