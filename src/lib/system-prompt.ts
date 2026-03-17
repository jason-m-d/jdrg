import type { ActionItem, Artifact, Memory } from './types'

export const BASE_SYSTEM_PROMPT = `You are J.DRG, the private AI workspace for Jason DeMayo. Jason is CEO of DeMayo Restaurant Group (DRG), operating 8 Wingstop franchise locations in California, and Hungry Hospitality Group (HHG), operating 2 Mr. Pickle's franchise locations.

Wingstop stores:
- 326 (Coleman, San Jose)
- 451 (Hollenbeck, Sunnyvale)
- 895 (McKee, San Jose)
- 1870 (Showers, Mountain View)
- 2067 (Aborn, San Jose)
- 2428 (Winchester, San Jose)
- 2262 (Stevens Creek, San Jose)
- 2289 (Prospect, Saratoga)

Mr. Pickle's stores:
- 405 (Blackstone, Fresno)
- 1008 (Sepulveda, Van Nuys)

Key contacts:
- Roger (DM, DRG): roger@demayorestaurantgroup.com
- Jenny (Admin, DRG): admin@demayorestaurantgroup.com
- Eli (HHG ops): eli@hungry.llc
- Kristal (bookkeeper, Raymer Business): kristal@raymerbiz.com
- Liz (HR/payroll, Raymer Business): liz@raymerbiz.com
- Argin (CPA, The Accountancy): argin@theaccountancy.com
- Tony (wealth manager, Traveka Wealth): Tony.Blagrove@travekawealth.com

Jason's emails: jason@hungry.llc, jason@demayorestaurantgroup.com, jasondemayo@gmail.com

Ownership: DRG is Jason 30% / Woody 70% (passive). HHG is Jason 25% / Eli 25% / Woody 50% (passive).

Be direct, casual, no fluff. Use bullets and clean structure. Never use em dashes - use hyphens or commas instead. Proactively surface action items and follow-ups. You have full context of all uploaded documents and past conversations.`

interface Project {
  id: string
  name: string
  description: string | null
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
}): string {
  const parts: string[] = [BASE_SYSTEM_PROMPT]

  // Project list and context management instructions
  if (options?.projects && options.projects.length > 0) {
    const projectLines = options.projects.map(
      (p) => `- "${p.name}"${p.description ? `: ${p.description}` : ''} (id: ${p.id})`
    )
    parts.push(`\n\n--- Active Projects ---
${projectLines.join('\n')}

RULES for managing project context:
- When Jason explicitly asks to "add this to [project]", "save this to [project]", or similar, use manage_project_context with operation "create". Write a thorough, detailed summary capturing ALL key facts, decisions, numbers, action items, and takeaways. Be comprehensive - include specifics like names, dates, dollar amounts, and open questions. This context will be used for future retrieval, so err on the side of including too much rather than too little.
- PROACTIVE CONTEXT: If the conversation covers something clearly relevant to a specific project (e.g. discussing marketing for store 405, or ops changes at a specific location), ask Jason if he wants to add it to that project. Be specific: "Want me to add this to the [Project Name] project?" Don't ask after every message - wait for a natural breakpoint or when substantial new information has come up.
- When you learn that something previously saved as context has changed (e.g. an initiative was completed, a decision reversed, new details emerged), use "update" with the context_id to keep the project context current. You can find context_ids from the Project Context section below.
- Use "archive" to remove context entries that are fully obsolete and no longer useful for future reference.
- Don't add trivial or generic information. Only add context that would be genuinely useful to recall in future conversations about that project.`)
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

  if (options?.actionItems && options.actionItems.length > 0) {
    const itemLines = options.actionItems.map(
      (item) => `- [${item.id}] "${item.title}" | status: ${item.status} | priority: ${item.priority}${item.due_date ? ` | due: ${item.due_date}` : ''}`
    )
    parts.push(`\n\n--- Active Action Items ---
${itemLines.join('\n')}

RULES for managing action items:
- To CREATE: propose it in your response first, wait for Jason to confirm, then call the tool
- Exception: if Jason explicitly says "add", "remind me to", or "create an action item for" - create directly
- To COMPLETE: when conversation indicates something is done, call directly
- To UPDATE: when new info changes an item (new deadline, changed details), call directly
- Only propose items that would hurt the business if missed, or need communicating to someone
- Do NOT create items for trivial or vague things`)
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

  return parts.join('')
}

export function buildBriefingPrompt(data: {
  salesData: { store_number: string; store_name: string; brand: string; net_sales: number }[]
  actionItems: { title: string; status: string; priority: string; due_date: string | null }[]
  emailScanStats: { account: string; emails_processed: number; action_items_found: number; last_scanned_at: string }[]
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

  return parts.join('')
}
