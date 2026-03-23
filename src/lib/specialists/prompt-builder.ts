/**
 * Specialist-aware prompt builder.
 *
 * Replaces the monolithic buildSystemPrompt() with a composable system where
 * only active specialists contribute their sections. The result is a smaller
 * prompt because inactive specialists don't add any text.
 */

import type { SpecialistDefinition } from './types'
import type { ActionItem, Artifact, Memory, DashboardCard, NotificationRule, UIPreference, Note, Contact } from '@/lib/types'
import { BASE_SYSTEM_PROMPT, type CalendarEventEntry, type RecentText } from '@/lib/system-prompt'

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

interface Project {
  id: string
  name: string
  description: string | null
}

interface Decision {
  decision_text: string
  context: string | null
  alternatives_considered: string | null
  decided_at: string
}

export interface PromptBuilderContext {
  previousSessionSummary?: string | null
  currentTime: string
  relevantProjects?: string[]        // project names detected by the router
  projectSystemPrompt?: string | null
  activeArtifactId?: string | null
  // Loaded data blobs keyed by data block name
  memories?: Memory[]
  actionItems?: ActionItem[]
  actionItemsCritical?: { items: ActionItem[]; totalCount: number }
  artifacts?: Artifact[]
  projects?: Project[]
  contacts?: Contact[]
  notes?: Note[]
  decisions?: Decision[]
  dashboardCards?: DashboardCard[]
  notificationRules?: NotificationRule[]
  uiPreferences?: UIPreference[]
  awaitingReplies?: AwaitingReply[]
  activeWatches?: ActiveWatch[]
  calendarEvents?: CalendarEventEntry[]
  recentTexts?: RecentText[]
  documentContext?: string | null
  trainingContext?: string | null
}

const JASON_EMAILS = ['jason@hungry.llc', 'jason@demayorestaurantgroup.com', 'jasondemayo@gmail.com']

function formatCalendarSection(
  events: CalendarEventEntry[],
  contacts?: Contact[],
  actionItems?: ActionItem[],
): string {
  if (!events || events.length === 0) return ''

  const contactByEmail = new Map<string, Contact>()
  if (contacts) {
    for (const c of contacts) {
      if (c.email) contactByEmail.set(c.email.toLowerCase(), c)
    }
  }

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

  const nowPT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const todayStr = `${nowPT.getFullYear()}-${String(nowPT.getMonth() + 1).padStart(2, '0')}-${String(nowPT.getDate()).padStart(2, '0')}`
  const tomorrowDate = new Date(nowPT)
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrowStr = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`

  const totalEvents = events.length
  const shouldTruncate = totalEvents > 12
  const eventsToShow = shouldTruncate ? events.slice(0, 8) : events

  const allDay: CalendarEventEntry[] = []
  const timed: CalendarEventEntry[] = []
  for (const evt of eventsToShow) {
    if (evt.all_day) allDay.push(evt)
    else timed.push(evt)
  }

  function getDayLabel(dateStr: string | null): string {
    if (!dateStr) return 'Today'
    const date = dateStr.slice(0, 10)
    if (date === todayStr) return 'Today'
    if (date === tomorrowStr) return 'Tomorrow'
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

  const dayGroups = new Map<string, CalendarEventEntry[]>()
  for (const evt of [...allDay, ...timed]) {
    const label = getDayLabel(evt.start_time)
    if (!dayGroups.has(label)) dayGroups.set(label, [])
    dayGroups.get(label)!.push(evt)
  }

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

/**
 * Render all {{placeholder}} tokens in a specialist's prompt section
 * using the loaded data from the context.
 */
function renderSection(template: string, ctx: PromptBuilderContext): string {
  let result = template

  // {{awaiting_replies_section}}
  result = result.replace('{{awaiting_replies_section}}', () => {
    if (!ctx.awaitingReplies || ctx.awaitingReplies.length === 0) return ''
    const now = new Date()
    const lines = ctx.awaitingReplies.map(r => {
      const sentDate = new Date(r.last_message_date)
      const daysAgo = Math.floor((now.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24))
      const dateStr = sentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })
      return `- You emailed ${r.recipient_email} about "${r.subject}" on ${dateStr} (${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago) - no reply yet`
    })
    return `\n\n--- Awaiting Replies ---
These are outbound emails Jason sent that haven't gotten a reply yet. When you encounter ANY information related to these (in email search results, documents, or conversation), proactively flag the connection. Don't just list results neutrally - tell Jason "this is the reply to your outreach about X" or "this might be related to that email you sent about Y."

${lines.join('\n')}`
  })

  // {{calendar_section}}
  result = result.replace('{{calendar_section}}', () => {
    if (!ctx.calendarEvents || ctx.calendarEvents.length === 0) return ''
    return formatCalendarSection(ctx.calendarEvents, ctx.contacts, ctx.actionItems)
  })

  // {{action_items_section}}
  result = result.replace('{{action_items_section}}', () => {
    if (!ctx.actionItems || ctx.actionItems.length === 0) return ''
    const itemLines = ctx.actionItems.map(
      item => `- [${item.id}] "${item.title}" | status: ${item.status} | priority: ${item.priority}${item.due_date ? ` | due: ${item.due_date}` : ''}${item.snoozed_until ? ` | snoozed until: ${item.snoozed_until}` : ''}`
    )
    return `\n\n--- Active Action Items ---
⚠️ IMPORTANT: The items below are for context when creating/updating/completing items. When the user asks to SEE their action items, you MUST call manage_action_items with operation: "list" — do NOT write them out as text. The tool call renders interactive card tracks in the UI.

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

LISTING ITEMS:
- When Jason asks to see his action items (e.g. "what are my action items?", "show me my list", "what's on my plate?"), call manage_action_items with operation: "list". This renders interactive card tracks in the UI — the cards ARE the response. After calling the tool, write a BRIEF editorial comment (1-2 sentences max) about the state of the list — e.g. "You've got 3 overdue items that need attention" or "Looking pretty clean — just a few things on deck." Do NOT enumerate or list the items as text. Do NOT repeat item titles. The UI handles all the data display.

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
- CROSS-FEATURE: If multiple action items cluster around one topic, consider suggesting a project or dashboard card to track it. If completing an item required contacting someone, offer to draft the email.`
  })

  // {{action_items_critical_section}}
  result = result.replace('{{action_items_critical_section}}', () => {
    // If the full action_items_section is also active, skip this to avoid duplication
    if (ctx.actionItems && ctx.actionItems.length > 0) return ''

    const critical = ctx.actionItemsCritical
    if (!critical || critical.totalCount === 0) return ''

    const criticalItems = critical.items
    const otherCount = critical.totalCount - criticalItems.length

    if (criticalItems.length === 0) {
      return `\n\n--- Action Items Summary ---
You have ${critical.totalCount} active action item${critical.totalCount !== 1 ? 's' : ''}. None are high-priority or due soon.
When the user asks to see their action items, ALWAYS call manage_action_items with operation: "list" — this renders interactive card tracks. Do not list items as text.

NATURAL LANGUAGE MATCHING - match by description, not ID:
- "done with that" / "finished" / "taken care of" -> complete
- "push to next week" / "not now" / "later" / "remind me Friday" -> snooze
- "not my problem" / "never mind" / "drop it" -> dismiss
- "make it high priority" / "this is urgent" -> update priority

Be proactive: when Jason shares information that implies tasks, create action items directly.`
    }

    const itemLines = criticalItems.map(
      item => `- [${item.id}] "${item.title}" | status: ${item.status} | priority: ${item.priority}${item.due_date ? ` | due: ${item.due_date}` : ''}${item.snoozed_until ? ` | snoozed until: ${item.snoozed_until}` : ''}`
    )
    const summaryLine = otherCount > 0
      ? `\n(+ ${otherCount} other action item${otherCount !== 1 ? 's' : ''} not shown — if you need the full list, use request_additional_context with data_needed: ["action_items"])`
      : ''

    return `\n\n--- Critical Action Items ---
${itemLines.join('\n')}
(When the user asks to see their action items, call manage_action_items with operation: "list" to render interactive card tracks. Do not list items as text.)

NATURAL LANGUAGE MATCHING - match by description, not ID:
- "done with that" / "finished" / "taken care of" -> complete
- "push to next week" / "not now" / "later" / "remind me Friday" -> snooze
- "not my problem" / "never mind" / "drop it" -> dismiss
- "make it high priority" / "this is urgent" -> update priority

Be proactive: when Jason shares information that implies tasks, create action items directly.`
  })

  // {{projects_section}}
  result = result.replace('{{projects_section}}', () => {
    if (!ctx.projects || ctx.projects.length === 0) return ''
    const projectLines = ctx.projects.map(
      p => `- "${p.name}"${p.description ? `: ${p.description}` : ''} (id: ${p.id})`
    )
    return `\n\n--- Active Projects ---
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
- Use manage_project (not manage_project_context) for project-level changes.`
  })

  // {{project_system_prompt_section}}
  result = result.replace('{{project_system_prompt_section}}', () => {
    if (!ctx.projectSystemPrompt) return ''
    return `\n\n--- Project Instructions ---\n${ctx.projectSystemPrompt}`
  })

  // {{relevant_projects_hint}}
  result = result.replace('{{relevant_projects_hint}}', () => {
    if (!ctx.relevantProjects || ctx.relevantProjects.length === 0) return ''
    const names = ctx.relevantProjects.join(', ')
    return `\n\nThis conversation may relate to: ${names}. If useful context emerges, offer to save it to the relevant project(s).`
  })

  // {{artifacts_section}}
  result = result.replace('{{artifacts_section}}', () => {
    const artifactRules = `\n\nARTIFACT RULES:
- ALWAYS call manage_artifact when asked to create a plan, spec, checklist, or document. Never describe or list the content in text — call the tool and let the side panel display it.
- When updating an artifact, always send the FULL content - never send diffs or partial updates
- Create a NEW artifact when the topic is distinct. Update an EXISTING one when refining the same topic.
- For type "checklist", use \`- [ ] Item\` syntax for all items so they render as interactive checkboxes.
- Keep artifact names concise and descriptive
- To delete an artifact, call delete_artifact with the artifact_id and artifact_name. This shows a confirmation prompt to the user — do NOT assume the delete happened until you receive confirmation. Use this when asked to remove, archive, or clean up an artifact.`

    if (!ctx.artifacts || ctx.artifacts.length === 0) return artifactRules

    const activeId = ctx.activeArtifactId
    const artifactLines = ctx.artifacts.map(a => {
      if (a.id === activeId) {
        const preview = a.content.slice(0, 100) + (a.content.length > 100 ? '...' : '')
        return `- [${a.id}] "${a.name}" (${a.type}, v${a.version}) [ACTIVE]: ${preview}`
      }
      const preview = a.content.slice(0, 100) + (a.content.length > 100 ? '...' : '')
      return `- [${a.id}] "${a.name}" (${a.type}, v${a.version}): ${preview}`
    })
    return `\n\n--- Artifacts (this is the complete and current list — do not reference artifacts from conversation history that are not listed here) ---
${artifactLines.join('\n\n')}
${artifactRules}`
  })

  // {{document_context_section}}
  result = result.replace('{{document_context_section}}', () => {
    if (!ctx.documentContext) return ''
    return `\n\n--- Relevant Documents ---\n${ctx.documentContext}`
  })

  // {{recent_texts_section}}
  result = result.replace('{{recent_texts_section}}', () => {
    if (!ctx.recentTexts || ctx.recentTexts.length === 0) return ''
    const now = new Date()
    const textLines = ctx.recentTexts.map(t => {
      const ageMs = now.getTime() - new Date(t.message_date).getTime()
      const ageH = Math.floor(ageMs / 3600000)
      const ageM = Math.floor((ageMs % 3600000) / 60000)
      const ageStr = ageH > 0 ? `${ageH}h ago` : `${ageM}m ago`
      const sender = t.is_group_chat
        ? (t.group_chat_name ?? 'Group chat')
        : (t.contact_name ?? t.phone_number)
      const preview = t.message_text.slice(0, 120).replace(/\n/g, ' ')
      return `- ${sender} (${t.service}, ${ageStr}): "${preview}"`
    })
    return `\n\n--- Recent Flagged Texts ---\n${textLines.join('\n')}\n\nThese are business-relevant texts from the last 48 hours. Reference them naturally when relevant. Use search_texts to look up older messages or search by contact/keyword. Use manage_text_contacts to save contact names and roles. Use manage_group_whitelist to add group chats to the sync whitelist.`
  })

  // {{memories_section}}
  result = result.replace('{{memories_section}}', () => {
    if (!ctx.memories || ctx.memories.length === 0) return ''
    const lines = ctx.memories.map(m => `- [${m.category || 'general'}] ${m.content}`)
    return `\n\n--- Remembered Context ---\n${lines.join('\n')}`
  })

  // {{decisions_section}}
  result = result.replace('{{decisions_section}}', () => {
    if (!ctx.decisions || ctx.decisions.length === 0) return ''
    const lines = ctx.decisions.map(d => {
      const date = new Date(d.decided_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      let line = `- [${date}] ${d.decision_text}`
      if (d.context) line += ` (why: ${d.context})`
      if (d.alternatives_considered) line += ` [alternatives: ${d.alternatives_considered}]`
      return line
    })
    return `\n\n--- Past Decisions ---
${lines.join('\n')}

These are decisions Jason has made recently. Reference them when relevant - don't re-ask questions he's already answered. If new information contradicts a past decision, flag it.`
  })

  // {{notes_section}}
  result = result.replace('{{notes_section}}', () => {
    if (!ctx.notes || ctx.notes.length === 0) return ''
    const lines = ctx.notes.map(n =>
      `- ${n.title ? `[${n.title}] ` : ''}${n.content}${n.expires_at ? ` (expires ${new Date(n.expires_at).toLocaleDateString()})` : ' [pinned]'}`
    )
    return `\n\n--- Notepad ---\n${lines.join('\n')}\n\nThese are time-sensitive operational facts. Use manage_notepad to add, pin, or delete notes.`
  })

  // {{contacts_section}}
  result = result.replace('{{contacts_section}}', () => {
    if (!ctx.contacts || ctx.contacts.length === 0) return ''
    const lines = ctx.contacts.map(c => {
      const parts: string[] = [c.name]
      if (c.role || c.organization) parts.push(`${c.role || ''}${c.role && c.organization ? ', ' : ''}${c.organization || ''}`)
      if (c.email) parts.push(c.email)
      if (c.notes) parts.push(`(${c.notes})`)
      return `- ${parts.join(' | ')}`
    })
    return `\n\n--- Contacts ---\n${lines.join('\n')}\n\nUse manage_contacts to add, update, or delete contacts. When Jason mentions a new person, save them.`
  })

  // {{watches_section}}
  result = result.replace('{{watches_section}}', () => {
    if (!ctx.activeWatches || ctx.activeWatches.length === 0) return ''
    const watchLines = ctx.activeWatches.map(w => {
      const age = Math.floor((new Date().getTime() - new Date(w.created_at).getTime()) / (1000 * 60 * 60 * 24))
      const keywords = w.match_criteria?.keywords?.join(', ') || ''
      let line = `- [${w.watch_type}] Watching for: ${w.context} (${age} day${age !== 1 ? 's' : ''} old, priority: ${w.priority})`
      if (keywords) line += `\n  Keywords: ${keywords}`
      return line
    })
    return `\n\n--- Active Watches ---
You are monitoring these things for Jason. When you encounter related information in any context (emails, documents, conversation), flag it immediately and explain the connection. Don't be subtle - lead with "This is the [thing] you were waiting for" or "Heads up, this is related to [watch context]."

When Jason mentions outreach, waiting for something, following up, or expecting a response, proactively suggest creating a watch: "Want me to keep an eye out for that?"

Use create_watch to set up new watches, list_watches to show what's active, and cancel_watch to stop monitoring.

${watchLines.join('\n')}`
  })

  // {{dashboard_section}}
  result = result.replace('{{dashboard_section}}', () => {
    if (!ctx.dashboardCards || ctx.dashboardCards.length === 0) {
      return `\n\nNo dashboard cards are active. Use manage_dashboard to create summary/alert/custom cards that pin to the main dashboard when Jason asks.`
    }
    const cardLines = ctx.dashboardCards.map(
      c => `- [${c.id}] "${c.title}" (${c.card_type}): ${c.content.slice(0, 100)}${c.content.length > 100 ? '...' : ''}`
    )
    return `\n\n--- Active Dashboard Cards ---
${cardLines.join('\n')}

Use manage_dashboard to create/update/remove cards. Cards are pinned info boxes on the main dashboard.
- Create cards when Jason wants to pin a summary, tracker, or alert to the dashboard
- Update cards when the content changes - don't let them go stale
- Remove cards when they're no longer needed or the situation is resolved`
  })

  // {{notification_rules_section}}
  result = result.replace('{{notification_rules_section}}', () => {
    if (!ctx.notificationRules || ctx.notificationRules.length === 0) return ''
    const lines = ctx.notificationRules.map(
      r => `- [${r.id}] "${r.description}" (${r.match_type}: "${r.match_value}", active: ${r.is_active})`
    )
    return `\n\n--- Active Notification Rules ---
${lines.join('\n')}

Use manage_notification_rules to create/delete/toggle rules. Rules trigger email alerts based on sender, subject, or keyword matches. If Jason repeatedly searches for emails from the same sender or topic, suggest creating a rule.`
  })

  // {{preferences_section}}
  result = result.replace('{{preferences_section}}', () => {
    if (!ctx.uiPreferences || ctx.uiPreferences.length === 0) return ''
    const lines = ctx.uiPreferences.map(p => `- ${p.key}: ${p.value}`)
    return `\n\n--- UI Preferences ---
${lines.join('\n')}

Use manage_preferences to set/get UI preferences. Supported keys: sidebar_collapsed, accent_color.`
  })

  // Strip remaining unresolved placeholders (empty data)
  result = result.replace(/\{\{[a-z_]+\}\}/g, '')

  return result
}

/**
 * Build the system prompt from active specialists and loaded data.
 *
 * This replaces the monolithic buildSystemPrompt(). Only active specialists
 * contribute their sections, so the prompt is smaller for focused messages.
 */
export function buildSpecialistPrompt(
  activeSpecialists: SpecialistDefinition[],
  loadedData: Record<string, any>,
  baseContext: {
    previousSessionSummary?: string | null
    currentTime: string
    relevantProjects?: string[]
    projectSystemPrompt?: string | null
    activeArtifactId?: string | null
    trainingContext?: string | null
  },
): string {
  // Merge loaded data with base context into a PromptBuilderContext
  const ctx: PromptBuilderContext = {
    previousSessionSummary: baseContext.previousSessionSummary,
    currentTime: baseContext.currentTime,
    relevantProjects: baseContext.relevantProjects,
    projectSystemPrompt: baseContext.projectSystemPrompt,
    activeArtifactId: baseContext.activeArtifactId,
    trainingContext: baseContext.trainingContext,
    memories: loadedData.memories,
    actionItems: loadedData.action_items,
    actionItemsCritical: loadedData.action_items_critical,
    artifacts: loadedData.artifacts,
    projects: loadedData.projects,
    contacts: loadedData.contacts,
    notes: loadedData.notes,
    decisions: loadedData.decisions,
    dashboardCards: loadedData.dashboard_cards,
    notificationRules: loadedData.notification_rules,
    uiPreferences: loadedData.ui_preferences,
    awaitingReplies: loadedData.emails_awaiting,
    activeWatches: loadedData.watches,
    calendarEvents: loadedData.calendar,
    recentTexts: loadedData.texts,
    documentContext: loadedData.documents_rag || loadedData.context_chunks || null,
  }

  const parts: string[] = [
    BASE_SYSTEM_PROMPT,
    `\n\nCurrent date and time: ${baseContext.currentTime} (Pacific). This timestamp is regenerated with every message, so it is always accurate - do not hedge or say it might be stale.`,
  ]

  if (ctx.previousSessionSummary) {
    parts.push(`\n\n<conversation_context>\nSummary of earlier conversation:\n${ctx.previousSessionSummary}\n</conversation_context>`)
  }

  // Render each active specialist's prompt section with its loaded data
  for (const specialist of activeSpecialists) {
    const rendered = renderSection(specialist.systemPromptSection, ctx).trim()
    if (rendered) {
      parts.push(`\n\n${rendered}`)
    }
  }

  // Training context always appended if present (from core specialist data)
  if (ctx.trainingContext) {
    parts.push(`\n\n${ctx.trainingContext}`)
  }

  return parts.join('')
}
