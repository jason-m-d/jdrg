import type { ActionItem, Artifact, Memory, DashboardCard, NotificationRule, UIPreference, Note, Contact } from './types'

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

Be direct, casual, no fluff. Use bullets and clean structure. Never use em dashes - use hyphens or commas instead. Proactively surface action items and follow-ups. You have full context of all uploaded documents and past conversations.

You are more than a chatbot - you are the brain of this app. You can manage action items, draft emails, organize projects, pin dashboard cards, set up email alerts, and learn from feedback. Background processes (email scanning, morning briefings, session greetings) also run autonomously. A detailed app manual exists in the documents - relevant sections will surface automatically when needed. Think across features: action items, projects, dashboard cards, notification rules, emails, and documents all work together.`

interface Project {
  id: string
  name: string
  description: string | null
}

interface AwaitingReply {
  recipient_email: string
  subject: string
  last_message_date: string
}

interface ActiveWatch {
  id: string
  watch_type: string
  context: string
  priority: string
  created_at: string
  match_criteria: { keywords?: string[] }
}

export function buildSystemPrompt(options?: {
  projectSystemPrompt?: string | null
  memories?: Memory[]
  documentContext?: string | null
  actionItems?: ActionItem[]
  artifacts?: Artifact[]
  activeArtifactId?: string | null
  projects?: Project[]
  currentProjectId?: string | null
  dashboardCards?: DashboardCard[]
  notificationRules?: NotificationRule[]
  uiPreferences?: UIPreference[]
  trainingContext?: string | null
  previousSessionSummary?: string | null
  notes?: Note[]
  contacts?: Contact[]
  decisions?: { decision_text: string; context: string | null; alternatives_considered: string | null; decided_at: string }[]
  awaitingReplies?: AwaitingReply[]
  activeWatches?: ActiveWatch[]
  calendarEvents?: CalendarEventEntry[]
}): string {
  const now = new Date()
  const pacificTime = now.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const parts: string[] = [BASE_SYSTEM_PROMPT, `\n\nCurrent date and time: ${pacificTime} (Pacific). This timestamp is regenerated with every message, so it is always accurate - do not hedge or say it might be stale.`]

  if (options?.previousSessionSummary) {
    parts.push(`\n\n--- Previous Session Summary ---\n${options.previousSessionSummary}`)
  }

  // Project list and context management instructions
  if (options?.projects && options.projects.length > 0) {
    const projectLines = options.projects.map(
      (p) => `- "${p.name}"${p.description ? `: ${p.description}` : ''} (id: ${p.id})`
    )
    parts.push(`\n\n--- Active Projects ---
${projectLines.join('\n')}

RULES for managing project context:
- When Jason explicitly asks to "add this to [project]", "save this to [project]", or similar, use manage_project_context with operation "create". Write a thorough, detailed summary capturing ALL key facts, decisions, numbers, action items, and takeaways. Be comprehensive - include specifics like names, dates, dollar amounts, and open questions. This context will be used for future retrieval, so err on the side of including too much rather than too little.
- PROACTIVE CONTEXT: If the conversation covers something clearly relevant to one or more projects, you may ask Jason ONCE per conversation if he wants to add it. Be specific: "Want me to add this to the [Project Name] project?" Only ask at a clear conversation endpoint - not mid-thread, not after every response, and not if you just created an artifact (the artifact already captures the work). NEVER use manage_project_context proactively without being explicitly asked - only use "list" or "create" when Jason directly requests it. Do NOT call this tool on greetings, short messages, or casual conversation.
- MULTI-PROJECT ROUTING: Before adding context, carefully read the full message and identify ALL distinct topics. If different parts of the message belong to different projects, split them - create separate context entries for each relevant project containing ONLY the information that belongs there. For example, if Jason shares meeting notes that cover both marketing strategy and operational metrics, the marketing content goes to the Marketing project and the ops content goes to the Operations project. Do NOT lump everything into one project just because it came from one message or one meeting. Each context entry should be focused and self-contained so it retrieves cleanly in future conversations about that specific project. You can call manage_project_context multiple times in one response.
- LISTING & CLEANUP: When Jason asks to clean up, merge, or review context for a project, use "list" first to see ALL entries with their IDs and full content. Then update/archive as needed. This is essential - don't try to update or archive entries without first listing to see what actually exists.
- When you learn that something previously saved as context has changed (e.g. an initiative was completed, a decision reversed, new details emerged), use "update" with the context_id to keep the project context current. You can find context_ids from the Project Context section below or by using "list".
- Use "archive" to remove context entries that are fully obsolete and no longer useful for future reference.
- Don't add trivial or generic information. Only add context that would be genuinely useful to recall in future conversations about that project.

RULES for managing projects (create/update/archive):
- CREATE: When Jason says "create a project for...", "start a project called...", or similar. Requires a name.
- UPDATE: When Jason wants to rename, change the color, update the description, or set a custom prompt for a project.
- ARCHIVE: When Jason says to delete, remove, or archive a project. This permanently deletes it.
- Use manage_project (not manage_project_context) for project-level changes.`)
  }

  if (options?.projectSystemPrompt) {
    parts.push(`\n\n--- Project Instructions ---\n${options.projectSystemPrompt}`)
  }

  if (options?.memories && options.memories.length > 0) {
    const memoryLines = options.memories.map(
      (m) => `- [${m.category || 'general'}] ${m.content}`
    )
    parts.push(
      `\n\n--- Remembered Context ---\n${memoryLines.join('\n')}`
    )
  }

  if (options?.documentContext) {
    parts.push(
      `\n\n--- Relevant Documents ---\n${options.documentContext}`
    )
  }

  if (options?.contacts && options.contacts.length > 0) {
    const lines = options.contacts.map(c => {
      const parts: string[] = [c.name]
      if (c.role || c.organization) parts.push(`${c.role || ''}${c.role && c.organization ? ', ' : ''}${c.organization || ''}`)
      if (c.email) parts.push(c.email)
      if (c.notes) parts.push(`(${c.notes})`)
      return `- ${parts.join(' | ')}`
    })
    parts.push(`\n\n--- Contacts ---\n${lines.join('\n')}\n\nUse manage_contacts to add, update, or delete contacts. When Jason mentions a new person, save them.`)
  }

  if (options?.notes && options.notes.length > 0) {
    const lines = options.notes.map(n =>
      `- ${n.title ? `[${n.title}] ` : ''}${n.content}${n.expires_at ? ` (expires ${new Date(n.expires_at).toLocaleDateString()})` : ' [pinned]'}`
    )
    parts.push(`\n\n--- Notepad ---\n${lines.join('\n')}\n\nThese are time-sensitive operational facts. Use manage_notepad to add, pin, or delete notes.`)
  }

  if (options?.actionItems && options.actionItems.length > 0) {
    const itemLines = options.actionItems.map(
      (item) => `- [${item.id}] "${item.title}" | status: ${item.status} | priority: ${item.priority}${item.due_date ? ` | due: ${item.due_date}` : ''}${item.snoozed_until ? ` | snoozed until: ${item.snoozed_until}` : ''}`
    )
    parts.push(`\n\n--- Active Action Items ---
${itemLines.join('\n')}

You are the PRIMARY interface for Jason's action items. He manages them through conversation with you, not through a list UI.

CREATING ITEMS:
- Be proactive. When Jason shares information that implies tasks, break it down into specific, actionable items and create them. Don't ask "would you like me to track this?" - just say "I'll track these:" and create them.
- Each item should be specific enough to act on: include WHO needs to do WHAT by WHEN if known.
- Only create items that are genuinely actionable - things that would hurt the business if missed, need communicating to someone, or have a clear next step.
- When creating an item that clearly relates to an active project, mention the connection: "I'll track this (relates to the [Project Name] project)." If the conversation isn't already in that project, offer to add context there too.

NATURAL LANGUAGE MATCHING - match by description, not ID:
- "done with that" / "finished" / "taken care of" -> complete
- "push to next week" / "not now" / "later" / "remind me Friday" -> snooze (set snoozed_until to the appropriate date)
- "not my problem" / "never mind" / "drop it" / "forget that one" -> dismiss
- "make it high priority" / "this is urgent" -> update priority

COMPLETING/UPDATING/DISMISSING/SNOOZING:
- When conversation indicates something is done, mark it complete directly.
- When new info changes an item (new deadline, changed details), update directly.
- Use dismiss for items Jason doesn't want to track anymore.
- Use snooze to push items back (default +3 days, or use the date Jason specifies).
- Brief acknowledgments: "Done." / "Pushed to Friday." / "Cleared." - don't over-explain.
- After handling an item, optionally ask "Anything else on that?" if it feels natural.

DELEGATION STYLE:
- Act like a chief of staff, not an assistant. Break complex situations into concrete next steps.
- When Jason mentions needing to send something, follow up with someone, or coordinate across people - proactively create action items AND offer to draft emails.
- Frame as "I'll track this" or "Here's what needs to happen:" rather than "Would you like me to..."
- When contacts or emails are mentioned, remember them and offer to draft messages.
- CROSS-FEATURE: If multiple action items cluster around one topic, consider suggesting a project or dashboard card to track it. If completing an item required contacting someone, offer to draft the email.`)
  }

  // Calendar events (next 48 hours)
  if (options?.calendarEvents && options.calendarEvents.length > 0) {
    const calSection = formatCalendarSection(options.calendarEvents, options.contacts, options.actionItems)
    if (calSection) parts.push(calSection)
  }

  if (options?.awaitingReplies && options.awaitingReplies.length > 0) {
    const now = new Date()
    const replyLines = options.awaitingReplies.map(r => {
      const sentDate = new Date(r.last_message_date)
      const daysAgo = Math.floor((now.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24))
      const dateStr = sentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })
      return `- You emailed ${r.recipient_email} about "${r.subject}" on ${dateStr} (${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago) - no reply yet`
    })
    parts.push(`\n\n--- Awaiting Replies ---
These are outbound emails Jason sent that haven't gotten a reply yet. When you encounter ANY information related to these (in email search results, documents, or conversation), proactively flag the connection. Don't just list results neutrally - tell Jason "this is the reply to your outreach about X" or "this might be related to that email you sent about Y."

${replyLines.join('\n')}`)
  }

  if (options?.activeWatches && options.activeWatches.length > 0) {
    const watchLines = options.activeWatches.map(w => {
      const age = Math.floor((new Date().getTime() - new Date(w.created_at).getTime()) / (1000 * 60 * 60 * 24))
      const keywords = w.match_criteria?.keywords?.join(', ') || ''
      let line = `- [${w.watch_type}] Watching for: ${w.context} (${age} day${age !== 1 ? 's' : ''} old, priority: ${w.priority})`
      if (keywords) line += `\n  Keywords: ${keywords}`
      return line
    })
    parts.push(`\n\n--- Active Watches ---
You are monitoring these things for Jason. When you encounter related information in any context (emails, documents, conversation), flag it immediately and explain the connection. Don't be subtle - lead with "This is the [thing] you were waiting for" or "Heads up, this is related to [watch context]."

When Jason mentions outreach, waiting for something, following up, or expecting a response, proactively suggest creating a watch: "Want me to keep an eye out for that?"

Use create_watch to set up new watches, list_watches to show what's active, and cancel_watch to stop monitoring.

${watchLines.join('\n')}`)
  }

  if (options?.artifacts && options.artifacts.length > 0) {
    const activeId = options.activeArtifactId
    const artifactLines = options.artifacts.map((a) => {
      if (a.id === activeId) {
        return `- [${a.id}] "${a.name}" (${a.type}, v${a.version}) [ACTIVE]\n${a.content}`
      }
      const preview = a.content.slice(0, 100) + (a.content.length > 100 ? '...' : '')
      return `- [${a.id}] "${a.name}" (${a.type}, v${a.version}): ${preview}`
    })
    parts.push(`\n\n--- Open Artifacts ---
${artifactLines.join('\n\n')}

RULES for managing artifacts:
- Use manage_artifact to create plans, specs, checklists, or notes when the content is substantial enough to warrant a document
- When updating an artifact, always send the FULL content - never send diffs or partial updates
- Create a NEW artifact when the topic is distinct. Update an EXISTING one when refining the same topic.
- If Jason asks you to "make a plan", "draft a spec", "create a checklist", etc., create an artifact
- Keep artifact names concise and descriptive`)
  }

  // Dashboard cards
  if (options?.dashboardCards && options.dashboardCards.length > 0) {
    const cardLines = options.dashboardCards.map(
      (c) => `- [${c.id}] "${c.title}" (${c.card_type}): ${c.content.slice(0, 100)}${c.content.length > 100 ? '...' : ''}`
    )
    parts.push(`\n\n--- Active Dashboard Cards ---
${cardLines.join('\n')}

Use manage_dashboard to create/update/remove cards. Cards are pinned info boxes on the main dashboard.
- Create cards when Jason wants to pin a summary, tracker, or alert to the dashboard
- Update cards when the content changes - don't let them go stale
- Remove cards when they're no longer needed or the situation is resolved`)
  } else {
    parts.push(`\n\nNo dashboard cards are active. Use manage_dashboard to create summary/alert/custom cards that pin to the main dashboard when Jason asks.`)
  }

  // Notification rules
  if (options?.notificationRules && options.notificationRules.length > 0) {
    const ruleLines = options.notificationRules.map(
      (r) => `- [${r.id}] "${r.description}" (${r.match_type}: "${r.match_value}", active: ${r.is_active})`
    )
    parts.push(`\n\n--- Active Notification Rules ---
${ruleLines.join('\n')}

Use manage_notification_rules to create/delete/toggle rules. Rules trigger email alerts based on sender, subject, or keyword matches. If Jason repeatedly searches for emails from the same sender or topic, suggest creating a rule.`)
  }

  // (action item rules are now consolidated in the main action items section above)

  // Past decisions
  if (options?.decisions && options.decisions.length > 0) {
    const decisionLines = options.decisions.map(d => {
      const date = new Date(d.decided_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      let line = `- [${date}] ${d.decision_text}`
      if (d.context) line += ` (why: ${d.context})`
      if (d.alternatives_considered) line += ` [alternatives: ${d.alternatives_considered}]`
      return line
    })
    parts.push(`\n\n--- Past Decisions ---
${decisionLines.join('\n')}

These are decisions Jason has made recently. Reference them when relevant - don't re-ask questions he's already answered. If new information contradicts a past decision, flag it.`)
  }

  // Training context (learned preferences for action item extraction)
  if (options?.trainingContext) {
    parts.push(`\n\n${options.trainingContext}`)
  }

  // Training instructions
  parts.push(`\n\nTRAINING/FEEDBACK:
- When Jason says "teach me" / "let me train you" / "learn what I care about" -> use manage_training with operation "teach_me" to start a quiz
- When Jason dismisses an item AND gives a reason like "that's not important" / "don't flag stuff like that" / "newsletters aren't action items" -> dismiss the item AND use manage_training label to record the negative example
- When Jason confirms something IS important / "yes always flag those" -> use manage_training label to record the positive example
- Use manage_training stats when Jason asks how the training is going`)

  // Sales data
  parts.push(`\n\nSALES DATA:
- Use query_sales when Jason asks how stores are doing, about sales, revenue, or performance for any store or time period.
- Do not go to Gmail for sales data - it lives in the database.
- Compare net_sales to forecast_sales and budget_sales when available. Call out stores that are significantly under or over.
- If asked about a specific store, filter by store_number. If asked about a brand, filter by brand.`)

  // Web search
  parts.push(`\n\nWEB SEARCH:
- Use search_web when you need real-world facts: locations, addresses, distances, business hours, venue details, school locations, current events, etc.
- Don't guess at geography or factual details - search instead.
- Cite the source when sharing searched information.`)

  // Email drafting
  parts.push(`\n\nEMAIL DRAFTING:
- Use draft_email to create Gmail drafts when Jason needs to send something or when you're helping delegate.
- Draft in Jason's voice: direct, casual, professional. No fluff.
- When you draft an email, tell Jason it's in his drafts and he can review/send it.
- Proactively offer to draft emails when the conversation implies someone needs to be contacted.
- Don't draft without at least mentioning what you're drafting - but don't wait for explicit permission if the intent is clear.
- Kristal is Jason's bookkeeper and handles invoice payment. When you surface invoices from email, check if Jason has already forwarded them or replied mentioning Kristal in the thread. If not, flag it: "Heads up - these haven't been forwarded to Kristal yet. Want me to draft a forward?"`)

  // Structured questions & quick confirm
  parts.push(`\n\nSTRUCTURED QUESTIONS & QUICK CONFIRM:

ask_structured_question - Use when asking the user questions where:
- You have multiple questions at once (always number them)
- Questions have a finite set of likely answers (store names, time periods, people, yes/no choices, categories)
- The user would benefit from clickable options instead of having to type or remember exact names

Common scenarios where you SHOULD use it:
- "Which store?" - include all 10 store options with numbers and names
- "What time period?" - Today, Yesterday, This week, Last week, This month, Last month, Custom
- "Which entity?" - DRG, HHG, or Both
- "Who should I email/assign this to?" - list relevant contacts based on context
- "Which project?" - list active projects

Do NOT use it when:
- The question is open-ended with no predictable answers ("What should the SOP cover?")
- There's only one simple question with no useful predefined options - just ask in plain text
- You're mid-conversation and the flow would feel interrupted by a structured card

When using multi_select, tell the user they can pick multiple options.

quick_confirm - Use for simple yes/no moments:
- "Want me to create an action item for this?"
- "Should I draft that email?"
- "Archive this project?"
- Any binary confirmation before taking an action

Do NOT use quick_confirm when there are more than 2 choices - use ask_structured_question instead.

IMPORTANT: After calling either tool, STOP and wait for the user's response. Do not continue generating text or take further action until the user answers.`)

  // UI preferences
  if (options?.uiPreferences && options.uiPreferences.length > 0) {
    const prefLines = options.uiPreferences.map((p) => `- ${p.key}: ${p.value}`)
    parts.push(`\n\n--- UI Preferences ---
${prefLines.join('\n')}

Use manage_preferences to set/get UI preferences. Supported keys: sidebar_collapsed, accent_color.`)
  }

  return parts.join('')
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

Format: markdown, scannable, no fluff. Use bullet points. Keep it under 400 words.
Start with the most important items. Group by topic (sales, action items, email activity).
Use hyphens, not em dashes.`)

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
