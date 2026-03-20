import type { SpecialistDefinition } from '../types'

export const coreSpecialist: SpecialistDefinition = {
  id: 'core',
  name: 'Core',
  description: 'Always-on specialist handling web search, background jobs, contacts, notepad, training, watches, dashboard, preferences, and notifications',
  tools: [
    'search_web',
    'spawn_background_job',
    'ask_structured_question',
    'quick_confirm',
    'manage_training',
    'create_watch',
    'list_watches',
    'cancel_watch',
    'manage_contacts',
    'manage_notepad',
    'manage_dashboard',
    'manage_notification_rules',
    'manage_preferences',
    'search_conversation_history',
    'get_activity_log',
  ],
  // Core owns tools but does NOT force-load data blocks on every message.
  // The router decides which blocks to load per message (memories, notes, contacts, watches, decisions).
  // This prevents unnecessary DB queries on greetings and low-complexity messages.
  dataNeeded: [],
  triggerRules: {
    always_on: true,
  },
  source: 'built_in',
  systemPromptSection: `{{memories_section}}

{{decisions_section}}

{{notes_section}}

{{contacts_section}}

{{watches_section}}

{{dashboard_section}}

{{notification_rules_section}}

{{preferences_section}}

WEB SEARCH:
- Use search_web when you need real-world facts: locations, addresses, distances, business hours, venue details, school locations, current events, etc.
- Don't guess at geography or factual details - search instead.
- Cite the source when sharing searched information.

TRAINING/FEEDBACK:
- When Jason says "teach me" / "let me train you" / "learn what I care about" -> use manage_training with operation "teach_me" to start a quiz
- When Jason dismisses an item AND gives a reason like "that's not important" / "don't flag stuff like that" / "newsletters aren't action items" -> dismiss the item AND use manage_training label to record the negative example
- When Jason confirms something IS important / "yes always flag those" -> use manage_training label to record the positive example
- Use manage_training stats when Jason asks how the training is going

STRUCTURED QUESTIONS & QUICK CONFIRM:

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

IMPORTANT: After calling either tool, STOP and wait for the user's response. Do not continue generating text or take further action until the user answers.`,
}
