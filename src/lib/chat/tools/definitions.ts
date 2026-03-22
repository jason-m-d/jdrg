import Anthropic from '@anthropic-ai/sdk'

export const ACTION_ITEM_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_action_items',
  description: 'Create, complete, update, or list action items for Jason. Use this to track important tasks, mark things done, or check what is outstanding.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'complete', 'update', 'list', 'dismiss', 'snooze'],
        description: 'The operation to perform. dismiss = remove/not relevant. snooze = push back (default +3 days, or specify due_date).',
      },
      title: {
        type: 'string',
        description: 'Title for create operation',
      },
      description: {
        type: 'string',
        description: 'Description for create or update operation',
      },
      priority: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Priority for create or update operation',
      },
      due_date: {
        type: 'string',
        description: 'Due date (YYYY-MM-DD) for create or update operation',
      },
      item_id: {
        type: 'string',
        description: 'Action item ID for complete or update operations',
      },
      dismissal_reason: {
        type: 'string',
        description: 'Why the item was dismissed (e.g. "not relevant", "already handled"). Helps Crosby learn what to skip in the future.',
      },
    },
    required: ['operation'],
  },
}

export const ARTIFACT_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_artifact',
  description: 'Create or update an artifact (a named document like a plan, spec, checklist, or freeform note). Artifacts appear in a side panel alongside the chat. Always send the FULL content, not a diff or partial update.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'update'],
        description: 'Whether to create a new artifact or update an existing one',
      },
      artifact_id: {
        type: 'string',
        description: 'The artifact ID to update (required for update operation)',
      },
      name: {
        type: 'string',
        description: 'Name/title for the artifact',
      },
      content: {
        type: 'string',
        description: 'Full markdown content of the artifact. Always send complete content, never diffs.',
      },
      type: {
        type: 'string',
        enum: ['plan', 'spec', 'checklist', 'freeform'],
        description: 'Type of artifact. Default: freeform',
      },
    },
    required: ['operation', 'name', 'content'],
  },
}

export const MANAGE_PROJECT_CONTEXT_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_project_context',
  description: `Add, update, list, or archive context entries on a project. Use this to keep project knowledge current.
- "create": Add new context from the conversation. Write a thorough summary - this will be retrieved in future conversations.
- "update": Update an existing context entry when new information changes it (e.g. an initiative is completed, a decision changed, new details emerged). Provide the full updated content, not a diff.
- "list": List all context entries for a project. Use this to see what exists before updating, merging, or cleaning up entries. Returns titles, IDs, and content previews.
- "archive": Mark a context entry as outdated/completed so it stops surfacing in future conversations.
Use proactively when the conversation is clearly relevant to a project - ask Jason first before adding.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'update', 'list', 'archive'],
        description: 'The operation to perform',
      },
      project_name: {
        type: 'string',
        description: 'The name (or partial name) of the target project',
      },
      context_id: {
        type: 'string',
        description: 'The context entry ID (required for update and archive operations)',
      },
      summary_title: {
        type: 'string',
        description: 'A short descriptive title for the context entry (required for create, optional for update)',
      },
      summary_content: {
        type: 'string',
        description: 'A thorough, detailed summary. Include ALL key facts, decisions, numbers, action items, open questions, and takeaways. For updates, send the full updated content reflecting the current state. Required for create and update.',
      },
    },
    required: ['operation', 'project_name'],
  },
}

export const SEARCH_GMAIL_TOOL: Anthropic.Messages.Tool = {
  name: 'search_gmail',
  description: `Search Jason's Gmail for emails matching a query. Uses the same search syntax as the Gmail search bar (from:, subject:, newer_than:, has:attachment, etc.). Use this when Jason asks you to find, look up, or reference emails. Build smart queries from natural language — try alternate terms or acronyms if the first search returns few results (e.g. try "LSM" if "local store marketing" returns nothing). You can call this tool multiple times to refine your search. IMPORTANT: If a broad query like "in:inbox newer_than:1d" returns 0 results, that is almost certainly a connector problem — Jason always has emails. Flag it explicitly: "I got 0 results which seems wrong — the Gmail connector may be broken." Do not assume the inbox is empty.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Gmail search query (same syntax as Gmail search bar)',
      },
      max_results: {
        type: 'number',
        description: 'Max emails to return (default 10)',
      },
    },
    required: ['query'],
  },
}

export const MANAGE_PROJECT_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_project',
  description: 'Create, update, or archive (delete) projects. Use fuzzy name matching for update/archive.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'update', 'archive'],
        description: 'The operation to perform',
      },
      name: {
        type: 'string',
        description: 'Project name (required for create, used for fuzzy matching on update/archive)',
      },
      new_name: {
        type: 'string',
        description: 'New name for the project (update only, for renaming)',
      },
      description: {
        type: 'string',
        description: 'Project description',
      },
      color: {
        type: 'string',
        description: 'Hex color code (e.g. #3B82F6)',
      },
      system_prompt: {
        type: 'string',
        description: 'Custom system prompt for the project',
      },
    },
    required: ['operation', 'name'],
  },
}

export const MANAGE_BOOKMARKS_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_bookmarks',
  description: 'Create, list, or delete bookmarks on a project. Use fuzzy project name matching.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'list', 'delete'],
        description: 'The operation to perform',
      },
      project_name: {
        type: 'string',
        description: 'Project name (fuzzy match)',
      },
      url: {
        type: 'string',
        description: 'URL for create operation',
      },
      title: {
        type: 'string',
        description: 'Title for the bookmark',
      },
      description: {
        type: 'string',
        description: 'Description for the bookmark',
      },
      bookmark_id: {
        type: 'string',
        description: 'Bookmark ID for delete operation',
      },
    },
    required: ['operation', 'project_name'],
  },
}

export const MANAGE_DASHBOARD_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_dashboard',
  description: 'Create, update, or remove dashboard summary cards. Cards appear on the main dashboard as pinned info boxes.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'update', 'remove'],
        description: 'The operation to perform',
      },
      card_id: {
        type: 'string',
        description: 'Card ID for update/remove operations',
      },
      title: {
        type: 'string',
        description: 'Card title',
      },
      content: {
        type: 'string',
        description: 'Card content (markdown)',
      },
      card_type: {
        type: 'string',
        enum: ['summary', 'alert', 'custom'],
        description: 'Type of card (default: summary)',
      },
    },
    required: ['operation'],
  },
}

export const MANAGE_NOTIFICATION_RULES_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_notification_rules',
  description: 'Create, list, delete, or toggle notification rules. Rules trigger push notifications to Jason\'s phone when matching emails arrive. Use match_type "sender" for people (e.g. "john@example.com"), "subject" for subject line keywords, or "keyword" to match anywhere in the email.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'list', 'delete', 'toggle'],
        description: 'The operation to perform',
      },
      rule_id: {
        type: 'string',
        description: 'Rule ID for delete/toggle operations',
      },
      description: {
        type: 'string',
        description: 'Human-readable description of the rule',
      },
      match_type: {
        type: 'string',
        enum: ['sender', 'subject', 'keyword'],
        description: 'What to match against',
      },
      match_value: {
        type: 'string',
        description: 'The value to match (email address, subject text, keyword)',
      },
      match_field: {
        type: 'string',
        description: 'Which field to search (default: any)',
      },
    },
    required: ['operation'],
  },
}

export const MANAGE_PREFERENCES_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_preferences',
  description: 'Set, get, or list UI preferences. Supported keys: sidebar_collapsed, accent_color.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['set', 'get', 'list'],
        description: 'The operation to perform',
      },
      key: {
        type: 'string',
        description: 'Preference key (required for set/get)',
      },
      value: {
        type: 'string',
        description: 'Preference value (required for set)',
      },
    },
    required: ['operation'],
  },
}

export const DRAFT_EMAIL_TOOL: Anthropic.Messages.Tool = {
  name: 'draft_email',
  description: 'Create a Gmail draft email. The draft will appear in Jason\'s Gmail drafts folder for review before sending. Use this to help delegate tasks, follow up with contacts, or compose messages Jason asks for.',
  input_schema: {
    type: 'object' as const,
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address(es), comma-separated for multiple',
      },
      subject: {
        type: 'string',
        description: 'Email subject line',
      },
      body: {
        type: 'string',
        description: 'Email body text (plain text)',
      },
      cc: {
        type: 'string',
        description: 'CC email address(es), comma-separated',
      },
    },
    required: ['to', 'subject', 'body'],
  },
}

export const MANAGE_NOTEPAD_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_notepad',
  description: `Add, list, delete, or pin notes on the operational notepad. Always loaded into context. Use for time-sensitive operational facts that don't belong in a project: "ordered deposit slips for 2262", "Roger is out this week", "waiting on callback from landlord at 1008". Notes expire in 7 days unless pinned. NOT for project knowledge (use manage_project_context) or preferences (those go in memories).`,
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: { type: 'string', enum: ['create', 'list', 'delete', 'pin'], description: 'create = add (7-day expiry), list = show all, delete = remove early, pin = make permanent' },
      content: { type: 'string', description: 'Note content (required for create)' },
      title: { type: 'string', description: 'Optional short title' },
      note_id: { type: 'string', description: 'Required for delete and pin' },
    },
    required: ['operation'],
  },
}

export const MANAGE_CONTACTS_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_contacts',
  description: `Create, update, delete, or search contacts. Contacts are always loaded into context. Use when Jason mentions a new person, when info changes, or to look someone up.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: { type: 'string', enum: ['create', 'update', 'delete', 'search'], description: 'The operation to perform' },
      contact_id: { type: 'string', description: 'Required for update and delete' },
      name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      role: { type: 'string', description: 'Job title or role' },
      organization: { type: 'string' },
      notes: { type: 'string', description: 'Internal notes about this person' },
      query: { type: 'string', description: 'Search query (name, email, or org) — for search operation' },
    },
    required: ['operation'],
  },
}

export const TRAINING_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_training',
  description: 'Manage action item training. Use "teach_me" to start a quiz session with real email snippets. Use "label" to record feedback when Jason says something is or isn\'t an action item. Use "stats" to check training progress.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['teach_me', 'label', 'stats'],
        description: 'The operation to perform',
      },
      snippet: { type: 'string', description: 'The text being labeled (for label operation)' },
      is_action_item: { type: 'boolean', description: 'Whether snippet is an action item (for label operation)' },
      source_type: { type: 'string', enum: ['email', 'chat'], description: 'Source type for label operation' },
      action_item_id: { type: 'string', description: 'Related action item ID if labeling from a dismiss/feedback' },
    },
    required: ['operation'],
  },
}

export const SEARCH_WEB_TOOL: Anthropic.Messages.Tool = {
  name: 'search_web',
  description: 'Search the web for current information. Use this tool whenever you need: current events or news, prices or availability, addresses or business hours, information about specific people/companies/products/places, or anything time-sensitive. When in doubt, search — do not guess or answer from training data.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The search query' },
    },
    required: ['query'],
  },
}

export const SPAWN_BACKGROUND_JOB_TOOL: Anthropic.Messages.Tool = {
  name: 'spawn_background_job',
  description: `Spawn an async background job for research or analysis. Use this whenever Jason asks to research, investigate, deep dive, compile a briefing, or analyze something — whether it's about the outside world or his own data. The job runs in the background and posts results as an artifact in the side panel when done. Respond immediately with a brief confirmation that you're on it. Do NOT use this for quick factual questions — use the native web_search for those.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      job_type: {
        type: 'string',
        enum: ['deep_research', 'research', 'analysis', 'briefing', 'sop', 'overnight_build'],
        description: 'deep_research = external web research via Perplexity (industry trends, competitors, news, regulations). research/analysis/sop = internal data analysis via Claude Sonnet. briefing/overnight_build = simpler tasks via Gemini Flash.',
      },
      prompt: {
        type: 'string',
        description: 'Detailed prompt for the background agent. Include all relevant context - what to research, what to look for, what format to return results in. Be specific.',
      },
      topic_summary: {
        type: 'string',
        description: 'Short (3-6 word) description of what you\'re researching, for the push notification. e.g. "lease renewal terms", "Store 895 performance"',
      },
    },
    required: ['job_type', 'prompt', 'topic_summary'],
  },
}

export const CREATE_WATCH_TOOL: Anthropic.Messages.Tool = {
  name: 'create_watch',
  description: `Create a watch to monitor for specific emails, senders, keywords, or topics. Use proactively when Jason mentions outreach, waiting for something, following up, or expecting a response. Respond with "Got it, I'll keep an eye out for that."`,
  input_schema: {
    type: 'object' as const,
    properties: {
      watch_type: {
        type: 'string',
        enum: ['email_reply', 'keyword', 'sender', 'topic'],
        description: 'Type of watch: email_reply (waiting for a specific reply), keyword (monitoring for keywords), sender (watching a specific sender), topic (watching for a topic/subject area)',
      },
      description: {
        type: 'string',
        description: 'What to watch for, in plain language (e.g. "reply from earthquakes about sponsorship", "any email mentioning health inspection")',
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Keywords to match against incoming emails (optional)',
      },
      sender_email: {
        type: 'string',
        description: 'Specific email address to watch for (optional)',
      },
      sender_domain: {
        type: 'string',
        description: 'Domain to watch for (e.g. "sjearthquakes.com") (optional)',
      },
      priority: {
        type: 'string',
        enum: ['high', 'normal'],
        description: 'Priority level (default: normal)',
      },
    },
    required: ['watch_type', 'description'],
  },
}

export const LIST_WATCHES_TOOL: Anthropic.Messages.Tool = {
  name: 'list_watches',
  description: 'List all active watches. Use when Jason asks "what are you watching for?" or "what are you monitoring?"',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
}

export const CANCEL_WATCH_TOOL: Anthropic.Messages.Tool = {
  name: 'cancel_watch',
  description: 'Cancel/stop an active watch. Sets it to expired.',
  input_schema: {
    type: 'object' as const,
    properties: {
      watch_id: {
        type: 'string',
        description: 'The watch ID to cancel',
      },
    },
    required: ['watch_id'],
  },
}

export const CHECK_CALENDAR_TOOL: Anthropic.Messages.Tool = {
  name: 'check_calendar',
  description: 'View upcoming calendar events. Use when Jason asks about his schedule, meetings, or what\'s coming up.',
  input_schema: {
    type: 'object' as const,
    properties: {
      start_date: {
        type: 'string',
        description: 'Start date (YYYY-MM-DD). Defaults to today.',
      },
      end_date: {
        type: 'string',
        description: 'End date (YYYY-MM-DD). Defaults to tomorrow.',
      },
      query: {
        type: 'string',
        description: 'Optional text search to filter events by title, description, or attendee name/email.',
      },
    },
    required: [],
  },
}

export const FIND_AVAILABILITY_TOOL: Anthropic.Messages.Tool = {
  name: 'find_availability',
  description: 'Find open time slots on a given day. Use when Jason asks "when am I free?", "do I have time for...", or needs to schedule something.',
  input_schema: {
    type: 'object' as const,
    properties: {
      date: {
        type: 'string',
        description: 'The date to check (YYYY-MM-DD)',
      },
      min_duration_minutes: {
        type: 'number',
        description: 'Minimum slot duration in minutes (default: 30)',
      },
      start_hour: {
        type: 'number',
        description: 'Start of business hours (default: 9, meaning 9am PT)',
      },
      end_hour: {
        type: 'number',
        description: 'End of business hours (default: 17, meaning 5pm PT)',
      },
    },
    required: ['date'],
  },
}

export const ASK_STRUCTURED_QUESTION_TOOL: Anthropic.Messages.Tool = {
  name: 'ask_structured_question',
  description: 'Present the user with numbered questions, optionally with clickable answer choices. Use this instead of asking questions in plain text when you need structured input from the user. After calling this tool, STOP and wait for the user to respond — do not continue generating text.',
  input_schema: {
    type: 'object' as const,
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: 'number', description: 'Question number' },
            text: { type: 'string', description: 'The question text' },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional clickable answer choices',
            },
            multi_select: {
              type: 'boolean',
              description: 'Whether the user can pick multiple options (default: false)',
            },
          },
          required: ['number', 'text'],
        },
        description: 'Array of questions to present',
      },
    },
    required: ['questions'],
  },
}

export const QUICK_CONFIRM_TOOL: Anthropic.Messages.Tool = {
  name: 'quick_confirm',
  description: 'Present the user with a simple yes/no confirmation prompt. Use this when you need a quick go/no-go before taking an action. After calling this tool, STOP and wait for the user to respond — do not continue generating text.',
  input_schema: {
    type: 'object' as const,
    properties: {
      prompt: {
        type: 'string',
        description: 'What you are confirming (e.g. "Create an action item for Roger to fix labor at 326?")',
      },
      confirm_label: {
        type: 'string',
        description: 'Label for the confirm button (default: "Yes")',
      },
      deny_label: {
        type: 'string',
        description: 'Label for the deny button (default: "No")',
      },
    },
    required: ['prompt'],
  },
}

export const SEARCH_TEXTS_TOOL: Anthropic.Messages.Tool = {
  name: 'search_texts',
  description: 'Search iMessage/SMS text messages. Use when Jason asks about a text, wants to find something a contact said, or references a recent conversation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search term to match against message text (case-insensitive)' },
      contact_name: { type: 'string', description: 'Filter by contact name (partial match)' },
      phone_number: { type: 'string', description: 'Filter by phone number (exact, normalized)' },
      days_back: { type: 'number', description: 'How many days back to search (default: 7)' },
      include_outbound: { type: 'boolean', description: 'Include messages Jason sent (default: false, inbound only)' },
    },
    required: [],
  },
}

export const MANAGE_TEXT_CONTACTS_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_text_contacts',
  description: 'Add, list, or remove contacts in the iMessage bridge contact book. Use when Jason identifies who a phone number belongs to.',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['add_contact', 'list_contacts', 'remove_contact'],
        description: 'add_contact: save a name/role for a number. list_contacts: show all saved contacts. remove_contact: delete by phone number.',
      },
      phone_number: { type: 'string', description: 'Phone number (for add_contact or remove_contact)' },
      name: { type: 'string', description: 'Contact name (for add_contact)' },
      role: { type: 'string', description: 'Role like "gm", "vendor", "admin", "personal" (for add_contact)' },
    },
    required: ['action'],
  },
}

export const MANAGE_GROUP_WHITELIST_TOOL: Anthropic.Messages.Tool = {
  name: 'manage_group_whitelist',
  description: 'Manage which group chats are synced from iMessage. Use list_available_groups first to see what groups exist, then add ones Jason wants to monitor.',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['add_group', 'list_groups', 'remove_group', 'list_available_groups'],
        description: 'list_available_groups: show groups seen in recent messages (not yet whitelisted). add_group: whitelist a group. list_groups: show whitelisted groups. remove_group: remove from whitelist.',
      },
      chat_identifier: { type: 'string', description: 'The chat identifier from chat.db (for add_group or remove_group)' },
      display_name: { type: 'string', description: 'Human-readable name for the group (for add_group)' },
    },
    required: ['action'],
  },
}

export const QUERY_SALES_TOOL: Anthropic.Messages.Tool = {
  name: 'query_sales',
  description: 'Query sales data for Jason\'s stores from the database. Use this when Jason asks how stores are doing, asks about sales, revenue, or performance. Do not go to Gmail for sales data - it lives here.',
  input_schema: {
    type: 'object' as const,
    properties: {
      store_number: {
        type: 'string',
        description: 'Specific store number (e.g. "895"), or omit for all stores',
      },
      brand: {
        type: 'string',
        enum: ['wingstop', 'mrpickles'],
        description: 'Filter by brand, or omit for all brands',
      },
      start_date: {
        type: 'string',
        description: 'Start date (YYYY-MM-DD). Defaults to 7 days ago.',
      },
      end_date: {
        type: 'string',
        description: 'End date (YYYY-MM-DD). Defaults to today.',
      },
    },
    required: [],
  },
}

export const CREATE_CALENDAR_EVENT_TOOL: Anthropic.Messages.Tool = {
  name: 'create_calendar_event',
  description: 'Create a new calendar event. Use when Jason asks to schedule, book, or add something to his calendar.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'Event title',
      },
      start_time: {
        type: 'string',
        description: 'Start time in ISO 8601 format (e.g. 2026-03-19T14:00:00-07:00)',
      },
      end_time: {
        type: 'string',
        description: 'End time in ISO 8601 format (e.g. 2026-03-19T15:00:00-07:00)',
      },
      description: {
        type: 'string',
        description: 'Optional event description',
      },
      location: {
        type: 'string',
        description: 'Optional event location',
      },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional array of attendee email addresses',
      },
    },
    required: ['title', 'start_time', 'end_time'],
  },
}

export const REQUEST_ADDITIONAL_CONTEXT_TOOL: Anthropic.Messages.Tool = {
  name: 'request_additional_context',
  description: "Request additional data that wasn't loaded initially. Use this if you realize you need information (like calendar events, email data, sales figures, etc.) that isn't in your current context. Specify which data blocks you need.",
  input_schema: {
    type: 'object' as const,
    properties: {
      data_blocks: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'action_items', 'projects', 'artifacts', 'memories', 'documents_rag',
            'context_chunks', 'contacts', 'notes', 'calendar', 'emails_awaiting',
            'watches', 'dashboard_cards', 'notification_rules', 'ui_preferences',
            'training', 'decisions', 'texts', 'sales',
          ],
        },
        description: 'Which data blocks to load',
      },
      reason: {
        type: 'string',
        description: 'Why you need this data (for logging)',
      },
    },
    required: ['data_blocks'],
  },
}

export const SEARCH_CONVERSATION_HISTORY_TOOL: Anthropic.Messages.Tool = {
  name: 'search_conversation_history',
  description: 'Search through past conversation messages to find what was discussed about a topic. Use when the user references a past conversation, asks about something discussed before, or when you need context from a previous discussion that is not in your current context window.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'What to search for in past conversations',
      },
    },
    required: ['query'],
  },
}

export const GET_ACTIVITY_LOG_TOOL: Anthropic.Messages.Tool = {
  name: 'get_activity_log',
  description: "Query Crosby's own activity log. Use when Jason asks what Crosby has been doing, what crons ran, whether a job succeeded, what model was used, which specialists were active, or to review recent errors.",
  input_schema: {
    type: 'object' as const,
    properties: {
      event_types: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['chat_message', 'cron_job', 'background_job', 'router_decision', 'error', 'nudge_decision'],
        },
        description: 'Filter to specific event types. Omit to return all types.',
      },
      hours_back: {
        type: 'number',
        description: 'How many hours back to look (default: 24, max: 168)',
      },
      limit: {
        type: 'number',
        description: 'Max events to return (default: 50, max: 200)',
      },
    },
    required: [],
  },
}

export const DELETE_ARTIFACT_TOOL: Anthropic.Messages.Tool = {
  name: 'delete_artifact',
  description: 'Delete an artifact. This will surface a confirmation prompt to the user before deleting — do NOT assume the delete happened until the user confirms.',
  input_schema: {
    type: 'object' as const,
    properties: {
      artifact_id: { type: 'string', description: 'The artifact ID to delete' },
      artifact_name: { type: 'string', description: 'The artifact name (used in the confirmation prompt)' },
    },
    required: ['artifact_id', 'artifact_name'],
  },
}

export const OPEN_ARTIFACT_TOOL: Anthropic.Messages.Tool = {
  name: 'open_artifact',
  description: 'Open an existing artifact in the side panel. Use when Jason asks to see, open, or show a specific artifact by name.',
  input_schema: {
    type: 'object' as const,
    properties: {
      artifact_id: {
        type: 'string',
        description: 'The ID of the artifact to open',
      },
    },
    required: ['artifact_id'],
  },
}

export const ALL_TOOLS_MAP: Record<string, Anthropic.Messages.Tool> = {
  manage_action_items: ACTION_ITEM_TOOL,
  manage_artifact: ARTIFACT_TOOL,
  delete_artifact: DELETE_ARTIFACT_TOOL,
  open_artifact: OPEN_ARTIFACT_TOOL,
  manage_project: MANAGE_PROJECT_TOOL,
  manage_project_context: MANAGE_PROJECT_CONTEXT_TOOL,
  manage_notepad: MANAGE_NOTEPAD_TOOL,
  search_web: SEARCH_WEB_TOOL,
  spawn_background_job: SPAWN_BACKGROUND_JOB_TOOL,
  ask_structured_question: ASK_STRUCTURED_QUESTION_TOOL,
  quick_confirm: QUICK_CONFIRM_TOOL,
  manage_training: TRAINING_TOOL,
  create_watch: CREATE_WATCH_TOOL,
  list_watches: LIST_WATCHES_TOOL,
  cancel_watch: CANCEL_WATCH_TOOL,
  manage_contacts: MANAGE_CONTACTS_TOOL,
  search_gmail: SEARCH_GMAIL_TOOL,
  draft_email: DRAFT_EMAIL_TOOL,
  check_calendar: CHECK_CALENDAR_TOOL,
  find_availability: FIND_AVAILABILITY_TOOL,
  create_calendar_event: CREATE_CALENDAR_EVENT_TOOL,
  manage_dashboard: MANAGE_DASHBOARD_TOOL,
  manage_notification_rules: MANAGE_NOTIFICATION_RULES_TOOL,
  manage_preferences: MANAGE_PREFERENCES_TOOL,
  query_sales: QUERY_SALES_TOOL,
  search_texts: SEARCH_TEXTS_TOOL,
  manage_text_contacts: MANAGE_TEXT_CONTACTS_TOOL,
  manage_group_whitelist: MANAGE_GROUP_WHITELIST_TOOL,
  manage_bookmarks: MANAGE_BOOKMARKS_TOOL,
  request_additional_context: REQUEST_ADDITIONAL_CONTEXT_TOOL,
  search_conversation_history: SEARCH_CONVERSATION_HISTORY_TOOL,
  get_activity_log: GET_ACTIVITY_LOG_TOOL,
}
