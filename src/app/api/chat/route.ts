import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { retrieveRelevantChunks, getPinnedDocuments, getRelevantMemories, retrieveRelevantContextChunks, buildContext, retrieveRelevantDecisions } from '@/lib/rag'
import { generateQueryEmbedding } from '@/lib/embeddings'
import { chunkAndEmbedContext } from '@/lib/embed-context'
import { buildSystemPrompt, CalendarEventEntry, RecentText } from '@/lib/system-prompt'
import { classifyIntent, getToolsForDomains } from '@/lib/intent-classifier'
import { normalizePhone } from '@/lib/phone'
import { searchEmails, createDraft } from '@/lib/gmail'
import { getConnectedCalendarAccount, fetchUpcomingEvents, createCalendarEvent } from '@/lib/calendar'
import { buildFewShotBlock, storeTrainingExample, getTrainingStats } from '@/lib/training'
import { fetchEmails } from '@/lib/gmail'
import type { ActionItem, Artifact, DashboardCard, NotificationRule, Bookmark, UIPreference, Note, Contact } from '@/lib/types'
import { sendPushToAll } from '@/lib/push'
import { spawnBackgroundJob } from '@/lib/background-jobs'
import { getMainConversation } from '@/lib/proactive'
import { openrouterClient } from '@/lib/openrouter'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

const ACTION_ITEM_TOOL: Anthropic.Messages.Tool = {
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

const ARTIFACT_TOOL: Anthropic.Messages.Tool = {
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

const MANAGE_PROJECT_CONTEXT_TOOL: Anthropic.Messages.Tool = {
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

const SEARCH_GMAIL_TOOL: Anthropic.Messages.Tool = {
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

const MANAGE_PROJECT_TOOL: Anthropic.Messages.Tool = {
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

const MANAGE_BOOKMARKS_TOOL: Anthropic.Messages.Tool = {
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

const MANAGE_DASHBOARD_TOOL: Anthropic.Messages.Tool = {
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

const MANAGE_NOTIFICATION_RULES_TOOL: Anthropic.Messages.Tool = {
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

const MANAGE_PREFERENCES_TOOL: Anthropic.Messages.Tool = {
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

const DRAFT_EMAIL_TOOL: Anthropic.Messages.Tool = {
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

const MANAGE_NOTEPAD_TOOL: Anthropic.Messages.Tool = {
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

const MANAGE_CONTACTS_TOOL: Anthropic.Messages.Tool = {
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

const TRAINING_TOOL: Anthropic.Messages.Tool = {
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

const SEARCH_WEB_TOOL: Anthropic.Messages.Tool = {
  name: 'search_web',
  description: 'Search the web for current information - locations, addresses, business info, current events, venue details, anything you\'re not certain about.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The search query' },
    },
    required: ['query'],
  },
}

const SPAWN_BACKGROUND_JOB_TOOL: Anthropic.Messages.Tool = {
  name: 'spawn_background_job',
  description: `Spawn an async background job for tasks that would take a long time to research or analyze - deep dives into topics, document compilation, competitive analysis, multi-step research. Use this when Jason asks for something that would require significant digging. The job runs in the background and posts results back to chat when done. Respond immediately with a brief confirmation that you're on it.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      job_type: {
        type: 'string',
        enum: ['research', 'analysis', 'briefing', 'sop', 'overnight_build'],
        description: 'Type of job. research/analysis/sop use Claude Sonnet; briefing/overnight_build use Gemini Flash.',
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

const CREATE_WATCH_TOOL: Anthropic.Messages.Tool = {
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

const LIST_WATCHES_TOOL: Anthropic.Messages.Tool = {
  name: 'list_watches',
  description: 'List all active watches. Use when Jason asks "what are you watching for?" or "what are you monitoring?"',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
}

const CANCEL_WATCH_TOOL: Anthropic.Messages.Tool = {
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

const CHECK_CALENDAR_TOOL: Anthropic.Messages.Tool = {
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

const FIND_AVAILABILITY_TOOL: Anthropic.Messages.Tool = {
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

const ASK_STRUCTURED_QUESTION_TOOL: Anthropic.Messages.Tool = {
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

const QUICK_CONFIRM_TOOL: Anthropic.Messages.Tool = {
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

const SEARCH_TEXTS_TOOL: Anthropic.Messages.Tool = {
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

const MANAGE_TEXT_CONTACTS_TOOL: Anthropic.Messages.Tool = {
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

const MANAGE_GROUP_WHITELIST_TOOL: Anthropic.Messages.Tool = {
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

const QUERY_SALES_TOOL: Anthropic.Messages.Tool = {
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

const CREATE_CALENDAR_EVENT_TOOL: Anthropic.Messages.Tool = {
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

const ALL_TOOLS_MAP: Record<string, Anthropic.Messages.Tool> = {
  manage_action_items: ACTION_ITEM_TOOL,
  manage_artifact: ARTIFACT_TOOL,
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
}

async function executeSearchTexts(input: {
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

async function executeManageTextContacts(input: {
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

async function executeManageGroupWhitelist(input: {
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

async function executeWebSearch(query: string): Promise<string> {
  const searchClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })
  const response = await searchClient.messages.create({
    model: 'perplexity/sonar-pro-search',
    max_tokens: 1024,
    messages: [{ role: 'user', content: query }],
    ...({ extra_body: { provider: { sort: 'price' } } } as any),
  })
  return response.content[0].type === 'text' ? response.content[0].text : 'No results found.'
}

const JASON_EMAILS_SET = new Set(['jason@hungry.llc', 'jason@demayorestaurantgroup.com', 'jasondemayo@gmail.com'])

async function executeCheckCalendar(input: any): Promise<any> {
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

async function executeFindAvailability(input: any): Promise<any> {
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

async function executeCreateCalendarEvent(input: any): Promise<any> {
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

async function executeQuerySales(input: any): Promise<any> {
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

export async function POST(req: NextRequest) {
  const { message, conversation_id, project_id, active_artifact_id, model } = await req.json()
  const selectedModel = model || 'anthropic/claude-sonnet-4.6:exacto'

  // Create or get conversation
  let convId = conversation_id
  if (!convId) {
    const title = message.slice(0, 50) + (message.length > 50 ? '...' : '')
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .insert({ title, project_id })
      .select()
      .single()
    convId = conv.id
  }

  // Get or create session
  console.log('[Chat] getOrCreateSession start')
  const { sessionId, previousSummary } = await getOrCreateSession(convId)
  console.log('[Chat] getOrCreateSession done, sessionId:', sessionId)

  // Save user message
  await supabaseAdmin.from('messages').insert({
    conversation_id: convId,
    role: 'user',
    content: message,
    session_id: sessionId,
  })

  // Load conversation history for current session only (last 20 messages)
  const { data: history } = await supabaseAdmin
    .from('messages')
    .select('role, content, context_domains')
    .eq('conversation_id', convId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(20)

  // Skip vector search for short/vague messages - embeddings on "hi", "yes", "ok" etc.
  // will latch onto whatever happens to be in the store and hallucinate context
  const isSubstantiveMessage = message.trim().split(/\s+/).length >= 4

  // Classify intent to determine which domains (data + tools) are active for this message
  const lastAssistantMsg = (history || []).slice().reverse().find((m: any) => m.role === 'assistant')
  const recentDomains = lastAssistantMsg?.context_domains as string[] | null
  const domains = classifyIntent(message, recentDomains)

  // Contacts: inject when email, calendar, or people are active
  if (domains.has('email') || domains.has('calendar') || domains.has('people')) {
    domains.add('contacts')
  }

  // Generate query embedding once and reuse for all vector searches
  const queryEmbedding = isSubstantiveMessage
    ? await generateQueryEmbedding(message).catch(e => { console.error('Query embedding failed:', e.message); return undefined })
    : undefined

  // RAG retrieval + action items + artifacts + all projects + training context in parallel
  // Domain-gated queries skip the DB call entirely when the domain is inactive
  const [chunks, pinnedDocs, memories, actionItemsResult, projectResult, contextChunks, artifactsResult, allProjectsResult, dashboardCardsResult, notificationRulesResult, uiPreferencesResult, trainingContext, notesResult, contactsResult, relevantDecisions, awaitingRepliesResult, activeWatchesResult, calendarEventsResult, recentTextsResult] = await Promise.all([
    isSubstantiveMessage ? retrieveRelevantChunks(message, project_id, 8, 0.7, queryEmbedding).catch(e => { console.error('RAG retrieval failed:', e.message); return [] }) : Promise.resolve([]),
    project_id ? getPinnedDocuments(project_id) : Promise.resolve([]),
    isSubstantiveMessage ? getRelevantMemories(message) : Promise.resolve([]),
    supabaseAdmin
      .from('action_items')
      .select('*')
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .limit(30),
    project_id
      ? supabaseAdmin.from('projects').select('system_prompt').eq('id', project_id).single()
      : Promise.resolve({ data: null }),
    isSubstantiveMessage ? retrieveRelevantContextChunks(message, project_id, 5, 0.7, queryEmbedding).catch(e => { console.error('Context retrieval failed:', e.message); return [] }) : Promise.resolve([]),
    convId
      ? supabaseAdmin.from('artifacts').select('*').eq('conversation_id', convId).order('updated_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from('projects').select('id, name, description').order('name'),
    domains.has('dashboard')
      ? supabaseAdmin.from('dashboard_cards').select('*').eq('is_active', true).order('position')
      : Promise.resolve({ data: [] }),
    domains.has('alerts')
      ? supabaseAdmin.from('notification_rules').select('*').eq('is_active', true).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    domains.has('prefs')
      ? supabaseAdmin.from('ui_preferences').select('*')
      : Promise.resolve({ data: [] }),
    isSubstantiveMessage ? buildFewShotBlock(message, queryEmbedding).catch(e => { console.error('Training context failed:', e.message); return null }) : Promise.resolve(null),
    domains.has('notes')
      ? supabaseAdmin.from('notes').select('*').or('expires_at.is.null,expires_at.gt.' + new Date().toISOString()).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    domains.has('contacts')
      ? supabaseAdmin.from('contacts').select('*').order('name')
      : Promise.resolve({ data: [] }),
    isSubstantiveMessage ? retrieveRelevantDecisions(message, 5, 0.7, queryEmbedding).catch(e => { console.error('Decision retrieval failed:', e.message); return [] }) : Promise.resolve([]),
    domains.has('email')
      ? supabaseAdmin
          .from('email_threads')
          .select('last_sender_email, subject, last_message_date')
          .eq('direction', 'outbound')
          .eq('response_detected', false)
          .gte('last_message_date', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
          .order('last_message_date', { ascending: false })
      : Promise.resolve({ data: [] }),
    supabaseAdmin
      .from('conversation_watches')
      .select('id, watch_type, context, priority, created_at, match_criteria')
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(20),
    domains.has('calendar')
      ? supabaseAdmin
          .from('calendar_events')
          .select('title, start_time, end_time, all_day, location, attendees, organizer_email, status')
          .gte('start_time', new Date().toISOString())
          .lte('start_time', new Date(Date.now() + 48 * 3600000).toISOString())
          .order('start_time', { ascending: true })
      : Promise.resolve({ data: [] }),
    domains.has('texts')
      ? supabaseAdmin
          .from('text_messages')
          .select('contact_name, phone_number, message_text, service, message_date, is_from_me, is_group_chat, group_chat_name, flag_reason')
          .eq('flagged', true)
          .eq('is_from_me', false)
          .gte('message_date', new Date(Date.now() - 48 * 3600000).toISOString())
          .order('message_date', { ascending: false })
          .limit(15)
      : Promise.resolve({ data: [] }),
  ])

  console.log('[Chat] Promise.all done')
  const actionItems: ActionItem[] = actionItemsResult.data || []
  const artifacts: Artifact[] = artifactsResult.data || []
  const projectPrompt = projectResult.data?.system_prompt || ''
  const allProjects: { id: string; name: string; description: string | null }[] = allProjectsResult.data || []
  const dashboardCards: DashboardCard[] = dashboardCardsResult.data || []
  const notificationRules: NotificationRule[] = notificationRulesResult.data || []
  const uiPreferences: UIPreference[] = uiPreferencesResult.data || []
  const awaitingReplies = ((awaitingRepliesResult as any).data || []).map((r: any) => ({
    recipient_email: r.last_sender_email,
    subject: r.subject,
    last_message_date: r.last_message_date,
  }))
  const activeWatches = (activeWatchesResult as any).data || []
  const calendarEvents: CalendarEventEntry[] = (calendarEventsResult as any).data || []
  const recentTexts: RecentText[] = (recentTextsResult as any).data || []

  // Add artifactContent domain when the active artifact panel is open,
  // or when the message explicitly names an artifact
  if (active_artifact_id) {
    domains.add('artifactContent')
  } else if (artifacts.length > 0) {
    const msgLower = message.toLowerCase()
    if (artifacts.some((a: Artifact) => msgLower.includes(a.name.toLowerCase()))) {
      domains.add('artifactContent')
    }
  }

  // Build filtered tools array based on active domains
  const activeToolNames = getToolsForDomains(domains)
  const activeTools = activeToolNames.map(n => ALL_TOOLS_MAP[n]).filter((t): t is Anthropic.Messages.Tool => !!t)
  console.log(`[Intent] "${message.slice(0, 50)}" → domains: [${Array.from(domains).join(', ')}] | tools: ${activeTools.length}/${Object.keys(ALL_TOOLS_MAP).length}`)

  // Build context
  const context = buildContext(chunks, pinnedDocs, memories, contextChunks)
  const systemPrompt = buildSystemPrompt({
    projectSystemPrompt: projectPrompt,
    memories,
    documentContext: context,
    actionItems,
    artifacts,
    activeArtifactId: active_artifact_id,
    projects: allProjects,
    currentProjectId: project_id,
    dashboardCards,
    notificationRules,
    uiPreferences,
    trainingContext,
    previousSessionSummary: previousSummary,
    notes: (notesResult.data || []) as Note[],
    contacts: (contactsResult.data || []) as Contact[],
    decisions: relevantDecisions.length > 0 ? relevantDecisions : undefined,
    awaitingReplies: awaitingReplies.length > 0 ? awaitingReplies : undefined,
    activeWatches: activeWatches.length > 0 ? activeWatches : undefined,
    calendarEvents: calendarEvents.length > 0 ? calendarEvents : undefined,
    recentTexts: recentTexts.length > 0 ? recentTexts : undefined,
    domains,
  })

  // Build messages array for Claude, capped by character budget to avoid context overflow.
  // 40K chars ~= 10K tokens, leaving room for system prompt + tool schemas + operational data.
  const HISTORY_CHAR_BUDGET = 40000
  let historyCharCount = 0
  const trimmedHistory = (history || []).reduceRight((acc: any[], m: any) => {
    const len = (m.content || '').length
    if (historyCharCount + len > HISTORY_CHAR_BUDGET) return acc
    historyCharCount += len
    acc.unshift(m)
    return acc
  }, [])

  const chatMessages: Anthropic.Messages.MessageParam[] = trimmedHistory.map((m: any) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  // Stream response with tool use loop
  const encoder = new TextEncoder()
  let fullResponse = ''

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let currentMessages = [...chatMessages]
        let continueLoop = true

        while (continueLoop) {
          continueLoop = false

          console.log('[Chat] calling OpenRouter, model:', selectedModel, 'tools:', activeTools.length, 'msgs:', currentMessages.length)
          const response = anthropic.messages.stream({
            model: selectedModel,
            max_tokens: 4096,
            system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }] as any,
            messages: currentMessages,
            tools: activeTools,
            ...({ extra_body: { models: ['anthropic/claude-sonnet-4.6:exacto', 'google/gemini-3.1-pro-preview'], provider: { sort: 'latency' } } } as any),
          })

          // Catch stream-level errors (auth failures, rate limits, OpenRouter errors)
          // that don't surface through the async iterator
          response.on('error', (err) => {
            console.error('Stream-level error:', err?.message || err)
            throw err
          })

          // Collect content blocks for this turn
          const contentBlocks: Anthropic.Messages.ContentBlockParam[] = []
          let currentTextBlock = ''
          let currentToolUse: { id: string; name: string; inputJson: string } | null = null

          for await (const event of response) {
            if (event.type === 'content_block_start') {
              if (event.content_block.type === 'text') {
                // If there's already text from a previous block (e.g. before a tool call),
                // inject a space so the blocks don't run together in the output
                if (fullResponse.length > 0 && !/\s$/.test(fullResponse)) {
                  fullResponse += ' '
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: ' ' })}\n\n`))
                }
                currentTextBlock = ''
              } else if (event.content_block.type === 'tool_use') {
                currentToolUse = {
                  id: event.content_block.id,
                  name: event.content_block.name,
                  inputJson: '',
                }
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta') {
                currentTextBlock += event.delta.text
                fullResponse += event.delta.text
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`))
              } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
                currentToolUse.inputJson += event.delta.partial_json
              }
            } else if (event.type === 'content_block_stop') {
              if (currentToolUse) {
                let toolInput: any
                try {
                  toolInput = JSON.parse(currentToolUse.inputJson || '{}')
                } catch (_parseErr) {
                  console.error('Tool input JSON parse failed for', currentToolUse.name, '- partial input:', currentToolUse.inputJson)
                  toolInput = {}
                }
                contentBlocks.push({
                  type: 'tool_use',
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  input: toolInput,
                } as Anthropic.Messages.ContentBlock)

                // Send tool status event before execution
                const toolStatusLabels: Record<string, string> = {
                  manage_artifact: 'Working on artifact',
                  manage_project_context: 'Updating project context',
                  search_gmail: 'Searching your email',
                  draft_email: 'Drafting an email',
                  manage_project: 'Managing project',
                  manage_bookmarks: 'Saving a bookmark',
                  manage_dashboard: 'Updating dashboard',
                  manage_notification_rules: 'Setting up alert rule',
                  manage_preferences: 'Updating preferences',
                  manage_training: 'Running training',
                  manage_notepad: 'Updating notepad',
                  manage_contacts: 'Updating contacts',
                  search_web: `Searching the web`,
                  manage_action_items: 'Managing action items',
                  spawn_background_job: 'Starting background research',
                  create_watch: 'Setting up watch',
                  list_watches: 'Checking watches',
                  cancel_watch: 'Canceling watch',
                  ask_structured_question: 'Asking question',
                  quick_confirm: 'Asking for confirmation',
                  query_sales: 'Checking sales data',
                  search_texts: 'Searching texts',
                  manage_text_contacts: 'Updating text contacts',
                  manage_group_whitelist: 'Managing group whitelist',
                }
                const statusLabel = toolStatusLabels[currentToolUse.name] || 'Working'
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool_status: statusLabel })}\n\n`))

                // Execute the tool
                let toolResult: any
                if (currentToolUse.name === 'manage_artifact') {
                  toolResult = await executeArtifactTool(toolInput, convId, project_id)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    artifact: {
                      operation: toolInput.operation,
                      artifact: toolResult.artifact,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_project_context') {
                  toolResult = await executeManageProjectContext(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    project_context: toolResult,
                  })}\n\n`))
                } else if (currentToolUse.name === 'search_gmail') {
                  try {
                    const emails = await searchEmails(toolInput.query, toolInput.max_results || 10)

                    // Enrich results with awaiting-reply context
                    const { data: outboundThreads } = await supabaseAdmin
                      .from('email_threads')
                      .select('gmail_thread_id, last_sender_email, subject, last_message_date')
                      .eq('direction', 'outbound')
                      .eq('response_detected', false)
                      .gte('last_message_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

                    if (outboundThreads && outboundThreads.length > 0) {
                      // Common words to strip for keyword matching
                      const stopWords = new Set(['re:', 'fwd:', 'fw:', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between', 'through', 'after', 'before', 'above', 'below', 'and', 'but', 'or', 'not', 'no', 'so', 'if', 'then', 'than', 'that', 'this', 'it', 'its', 'my', 'your', 'his', 'her', 'our', 'their', 'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'us', 'them', 'up', 'out', 'just', 'also', 'very', 'all', 'any', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'same', 'new', 'old', 'hi', 'hello', 'hey', 'thanks', 'thank', 'please', 'regards'])

                      const extractKeywords = (text: string): Set<string> => {
                        return new Set(
                          text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
                            .filter(w => w.length > 2 && !stopWords.has(w))
                        )
                      }

                      const extractDomain = (email: string): string => {
                        const match = email.match(/@([^>]+)/)
                        return match ? match[1].toLowerCase() : ''
                      }

                      // Build lookup data for outbound threads
                      const outboundData = outboundThreads.map(t => ({
                        ...t,
                        recipientDomain: extractDomain(t.last_sender_email || ''),
                        keywords: extractKeywords(t.subject || ''),
                      }))

                      for (const email of emails) {
                        const senderDomain = extractDomain(email.from || '')
                        const emailKeywords = extractKeywords(`${email.subject || ''} ${email.snippet || ''}`)

                        for (const thread of outboundData) {
                          let matched = false

                          // Check 1: threadId match
                          if (email.threadId && email.threadId === thread.gmail_thread_id) {
                            matched = true
                          }

                          // Check 2: sender domain matches outbound recipient domain
                          if (!matched && senderDomain && thread.recipientDomain && senderDomain === thread.recipientDomain) {
                            matched = true
                          }

                          // Check 3: keyword overlap (at least 2 significant words)
                          if (!matched && thread.keywords.size > 0) {
                            let overlap = 0
                            for (const kw of thread.keywords) {
                              if (emailKeywords.has(kw)) overlap++
                            }
                            if (overlap >= 2) matched = true
                          }

                          if (matched) {
                            const sentDate = new Date(thread.last_message_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })
                            email.snippet += `\n[CONTEXT: This appears to be related to your outbound email about "${thread.subject}" sent on ${sentDate}. You were waiting for a reply on this.]`
                            break // Only annotate with the first match
                          }
                        }
                      }
                    }

                    toolResult = { status: 'ok', result_count: emails.length, emails }
                  } catch (e: any) {
                    toolResult = { status: 'error', message: e.message }
                  }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    gmail_search: { query: toolInput.query, result_count: toolResult.result_count || 0, error: toolResult.status === 'error' ? toolResult.message : undefined },
                  })}\n\n`))
                } else if (currentToolUse.name === 'draft_email') {
                  try {
                    const result = await createDraft(toolInput.to, toolInput.subject, toolInput.body, toolInput.cc)
                    toolResult = { status: 'drafted', draft_id: result.id, message: result.message }
                  } catch (e: any) {
                    toolResult = { status: 'error', message: e.message }
                  }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    email_draft: {
                      to: toolInput.to,
                      subject: toolInput.subject,
                      status: toolResult.status,
                      message: toolResult.message,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_project') {
                  toolResult = await executeProjectTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    project: {
                      operation: toolInput.operation,
                      project: toolResult.project,
                      status: toolResult.status,
                      message: toolResult.message,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_bookmarks') {
                  toolResult = await executeBookmarkTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    bookmark: {
                      operation: toolInput.operation,
                      bookmark: toolResult.bookmark,
                      bookmarks: toolResult.bookmarks,
                      status: toolResult.status,
                      message: toolResult.message,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_dashboard') {
                  toolResult = await executeDashboardCardTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    dashboard_card: {
                      operation: toolInput.operation,
                      card: toolResult.card,
                      status: toolResult.status,
                      message: toolResult.message,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_notification_rules') {
                  toolResult = await executeNotificationRuleTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    notification_rule: {
                      operation: toolInput.operation,
                      rule: toolResult.rule,
                      rules: toolResult.rules,
                      status: toolResult.status,
                      message: toolResult.message,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_preferences') {
                  toolResult = await executePreferencesTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    preference: {
                      key: toolInput.key,
                      value: toolResult.value,
                      status: toolResult.status,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_training') {
                  toolResult = await executeTrainingTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    training: {
                      operation: toolInput.operation,
                      result: toolResult,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'manage_notepad') {
                  toolResult = await executeNotepadTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ notepad: { operation: toolInput.operation, result: toolResult } })}\n\n`))
                } else if (currentToolUse.name === 'manage_contacts') {
                  toolResult = await executeContactsTool(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ contact: { operation: toolInput.operation, result: toolResult } })}\n\n`))
                } else if (currentToolUse.name === 'search_web') {
                  try {
                    const result = await executeWebSearch(toolInput.query)
                    toolResult = { status: 'ok', result }
                  } catch (e: any) {
                    toolResult = { status: 'error', message: e.message }
                  }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    web_search: { query: toolInput.query, result: toolResult.result || toolResult.message },
                  })}\n\n`))
                } else if (currentToolUse.name === 'spawn_background_job') {
                  try {
                    const job = await spawnBackgroundJob(
                      convId,
                      toolInput.job_type || 'research',
                      toolInput.prompt,
                      'user',
                      { topic_summary: toolInput.topic_summary }
                    )
                    toolResult = {
                      status: 'spawned',
                      job_id: job.id,
                      message: `Background job started. I'll dig into "${toolInput.topic_summary}" and post results in this chat when done.`,
                    }
                  } catch (e: any) {
                    toolResult = { status: 'error', message: e.message }
                  }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    background_job: {
                      status: toolResult.status,
                      topic: toolInput.topic_summary,
                      job_id: toolResult.job_id,
                    },
                  })}\n\n`))
                } else if (currentToolUse.name === 'create_watch') {
                  toolResult = await executeCreateWatch(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ watch: { operation: 'create', result: toolResult } })}\n\n`))
                } else if (currentToolUse.name === 'list_watches') {
                  toolResult = await executeListWatches()
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ watch: { operation: 'list', result: toolResult } })}\n\n`))
                } else if (currentToolUse.name === 'cancel_watch') {
                  toolResult = await executeCancelWatch(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ watch: { operation: 'cancel', result: toolResult } })}\n\n`))
                } else if (currentToolUse.name === 'check_calendar') {
                  toolResult = await executeCheckCalendar(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ calendar: { operation: 'check', result: toolResult } })}\n\n`))
                } else if (currentToolUse.name === 'find_availability') {
                  toolResult = await executeFindAvailability(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ calendar: { operation: 'availability', result: toolResult } })}\n\n`))
                } else if (currentToolUse.name === 'create_calendar_event') {
                  toolResult = await executeCreateCalendarEvent(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ calendar: { operation: 'create', result: toolResult } })}\n\n`))
                } else if (currentToolUse.name === 'ask_structured_question') {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    structured_question: { questions: toolInput.questions },
                  })}\n\n`))
                  toolResult = { status: 'ok', message: 'Questions presented to user. Waiting for response.' }
                } else if (currentToolUse.name === 'quick_confirm') {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    quick_confirm: {
                      prompt: toolInput.prompt,
                      confirm_label: toolInput.confirm_label || 'Yes',
                      deny_label: toolInput.deny_label || 'No',
                    },
                  })}\n\n`))
                  toolResult = { status: 'ok', message: 'Confirmation prompt presented to user. Waiting for response.' }
                } else if (currentToolUse.name === 'query_sales') {
                  toolResult = await executeQuerySales(toolInput)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sales_query: { status: toolResult.status, row_count: toolResult.rows?.length || 0 } })}\n\n`))
                } else if (currentToolUse.name === 'search_texts') {
                  toolResult = await executeSearchTexts(toolInput)
                } else if (currentToolUse.name === 'manage_text_contacts') {
                  toolResult = await executeManageTextContacts(toolInput)
                } else if (currentToolUse.name === 'manage_group_whitelist') {
                  toolResult = await executeManageGroupWhitelist(toolInput)
                } else {
                  toolResult = await executeActionItemTool(toolInput, convId, actionItems)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    action_item: {
                      operation: toolInput.operation,
                      result: toolResult,
                    }
                  })}\n\n`))
                }

                // Build messages for next turn
                currentMessages = [
                  ...currentMessages,
                  { role: 'assistant' as const, content: contentBlocks },
                  {
                    role: 'user' as const,
                    content: [{
                      type: 'tool_result' as const,
                      tool_use_id: currentToolUse.id,
                      content: JSON.stringify(toolResult),
                    }],
                  },
                ]

                const stopAfterTool = currentToolUse.name === 'ask_structured_question' || currentToolUse.name === 'quick_confirm'
                currentToolUse = null
                continueLoop = !stopAfterTool
              } else if (currentTextBlock) {
                contentBlocks.push({
                  type: 'text',
                  text: currentTextBlock,
                })
                currentTextBlock = ''
              }
            }
          }
        }

        // Save assistant message
        const sources = chunks.map((c: any) => ({
          document_id: c.document_id,
          chunk_content: c.content.slice(0, 200),
          similarity_score: c.similarity,
        }))

        await supabaseAdmin.from('messages').insert({
          conversation_id: convId,
          role: 'assistant',
          content: fullResponse,
          sources,
          session_id: sessionId,
          context_domains: Array.from(domains),
        })

        // Increment session message count (user + assistant = 2)
        void supabaseAdmin.rpc('increment_session_message_count', { session_id_param: sessionId, increment_by: 2 })

        // Update conversation timestamp
        await supabaseAdmin
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', convId)

        // Run memory extraction (action item extraction removed - handled by tool use)
        await extractMemories(convId, message, fullResponse)

        // Send done event with conversation_id
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, conversation_id: convId, sources })}\n\n`))
        controller.close()
      } catch (error) {
        const errMsg = error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error)
        console.error('[Chat] error name:', error instanceof Error ? error.name : typeof error)
        console.error('[Chat] error msg:', error instanceof Error ? error.message : String(error))
        console.error('[Chat] error full:', errMsg)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Failed to generate response', debug: errMsg })}\n\n`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

async function executeActionItemTool(
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

async function executeArtifactTool(
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

async function executeManageProjectContext(
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

async function executeProjectTool(
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

async function executeBookmarkTool(
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

async function executeDashboardCardTool(
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

async function executeNotificationRuleTool(
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

async function executePreferencesTool(
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

async function executeTrainingTool(
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

async function getOrCreateSession(convId: string): Promise<{ sessionId: string; previousSummary: string | null }> {
  // Look for open session
  const { data: openSession } = await supabaseAdmin
    .from('sessions')
    .select('*')
    .eq('conversation_id', convId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  const now = new Date()

  if (openSession) {
    // Check if we should close this session: 30+ messages OR last message > 2 hours ago
    const { data: lastMsg } = await supabaseAdmin
      .from('messages')
      .select('created_at')
      .eq('session_id', openSession.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const lastMsgAge = lastMsg
      ? (now.getTime() - new Date(lastMsg.created_at).getTime()) / (1000 * 60 * 60)
      : 0

    const shouldClose = openSession.message_count >= 30 || lastMsgAge > 2

    if (!shouldClose) {
      // Fetch previous closed session summary for injection
      const { data: prevSession } = await supabaseAdmin
        .from('sessions')
        .select('summary')
        .eq('conversation_id', convId)
        .not('ended_at', 'is', null)
        .order('ended_at', { ascending: false })
        .limit(1)
        .single()

      return { sessionId: openSession.id, previousSummary: prevSession?.summary || null }
    }

    // Close the open session
    await supabaseAdmin
      .from('sessions')
      .update({ ended_at: now.toISOString() })
      .eq('id', openSession.id)

    // Fire-and-forget summarization
    summarizeSession(openSession.id, convId).catch(e => console.error('Session summarization failed:', e))
  }

  // Fetch last closed session summary
  const { data: lastClosed } = await supabaseAdmin
    .from('sessions')
    .select('summary')
    .eq('conversation_id', convId)
    .not('ended_at', 'is', null)
    .order('ended_at', { ascending: false })
    .limit(1)
    .single()

  // Create new session
  const { data: newSession } = await supabaseAdmin
    .from('sessions')
    .insert({ conversation_id: convId })
    .select()
    .single()

  return { sessionId: newSession!.id, previousSummary: lastClosed?.summary || null }
}

async function summarizeSession(sessionId: string, convId: string) {
  // Load all messages for this session
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (!messages || messages.length === 0) return

  const transcript = messages
    .map(m => `${m.role === 'user' ? 'Jason' : 'Crosby'}: ${m.content.slice(0, 500)}`)
    .join('\n\n')

  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

  const response = await anthropicClient.messages.create({
    model: 'google/gemini-3.1-flash-lite-preview',
    max_tokens: 800,
    system: `Summarize this conversation session for Jason DeMayo's AI workspace. Write bullet points under 400 words. Focus on: decisions made, information shared, action items created or discussed, open questions, and anything Crosby should remember for the next session. Be specific - include names, numbers, and dates.`,
    messages: [{ role: 'user', content: transcript }],
    ...({ extra_body: { models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'], provider: { sort: 'price' } } } as any),
  })

  const summary = response.content[0].type === 'text' ? response.content[0].text : ''
  if (!summary) return

  // Save summary
  await supabaseAdmin
    .from('sessions')
    .update({ summary })
    .eq('id', sessionId)

  // Extract notepad entries from summary
  extractNotepadEntriesFromSummary(summary).catch(e => console.error('Notepad extraction failed:', e))

  // Extract commitments Jason made during this session
  extractCommitmentsFromSession(sessionId, convId, transcript).catch(e => console.error('Commitment extraction failed:', e))

  // Extract decisions Jason made during this session
  extractDecisionsFromSession(sessionId, convId, transcript).catch(e => console.error('Decision extraction failed:', e))

  // Phase 3: Detect SOPs - check if Jason explained a process step-by-step
  detectAndTrackProcesses(convId, transcript, summary).catch(e => console.error('SOP detection failed:', e))

  // Extract watches from conversation (things Jason is waiting for or tracking)
  extractWatchesFromSession(convId, transcript).catch(e => console.error('Watch extraction failed:', e))
}

async function extractNotepadEntriesFromSummary(summary: string) {
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

  const notepadSchema = {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            title: { type: 'string' },
          },
          required: ['content', 'title'],
          additionalProperties: false,
        },
      },
    },
    required: ['entries'],
    additionalProperties: false,
  }

  const response = await anthropicClient.messages.create({
    model: 'google/gemini-3.1-flash-lite-preview',
    max_tokens: 400,
    system: `Extract 0-3 time-sensitive operational facts from this session summary that should go on the notepad. These are short-lived facts like "ordered deposit slips for 2262", "Roger is out this week", "waiting on callback from landlord at 1008". NOT general business knowledge. Return JSON: {"entries": [{"content": "...", "title": "..."}]} or {"entries": []} if nothing fits.`,
    messages: [{ role: 'user', content: summary }],
    ...({
      extra_body: {
        models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'],
        provider: { sort: 'price' },
        plugins: [{ id: 'response-healing' }],
        response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: notepadSchema } },
      },
    } as any),
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = parseJSON(text)
  }
  if (!parsed.entries || parsed.entries.length === 0) return

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  for (const entry of parsed.entries) {
    if (entry.content) {
      await supabaseAdmin.from('notes').insert({
        content: entry.content,
        title: entry.title || null,
        expires_at: expiresAt,
      })
    }
  }
}

async function extractCommitmentsFromSession(sessionId: string, convId: string, transcript: string) {
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

  const commitmentSchema = {
    type: 'object',
    properties: {
      commitments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            commitment_text: { type: 'string' },
            target_date: { type: ['string', 'null'] },
            related_contact: { type: ['string', 'null'] },
          },
          required: ['commitment_text', 'target_date', 'related_contact'],
          additionalProperties: false,
        },
      },
    },
    required: ['commitments'],
    additionalProperties: false,
  }

  const response = await anthropicClient.messages.create({
    model: 'google/gemini-3.1-flash-lite-preview',
    max_tokens: 400,
    system: `Extract commitments that JASON (the user) made during this conversation. Only extract things Jason said HE would do - not things Crosby (the AI) offered or did. Look for phrases like "I'll", "I need to", "I'm going to", "let me", "I should", "remind me to".

Examples of commitments: "I'll call Roger tomorrow", "I need to review the lease by Friday", "I'm going to email the franchise rep".

Do NOT extract:
- Things Crosby said it would do (drafting emails, creating items, etc.)
- Vague intentions without a clear action
- Things already captured as action items in the conversation

Today is ${new Date().toISOString().split('T')[0]}. Convert relative dates to absolute (e.g. "tomorrow" -> actual date, "next week" -> Monday of next week).

Return JSON: {"commitments": [{"commitment_text": "...", "target_date": "YYYY-MM-DD or null", "related_contact": "person name or null"}]}
Return {"commitments": []} if none found.`,
    messages: [{ role: 'user', content: transcript.slice(0, 6000) }],
    ...({
      extra_body: {
        models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'],
        provider: { sort: 'price' },
        plugins: [{ id: 'response-healing' }],
        response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: commitmentSchema } },
      },
    } as any),
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = parseJSON(text)
  }
  if (!parsed.commitments || parsed.commitments.length === 0) return

  for (const c of parsed.commitments) {
    if (c.commitment_text) {
      await supabaseAdmin.from('commitments').insert({
        session_id: sessionId,
        conversation_id: convId,
        commitment_text: c.commitment_text,
        target_date: c.target_date || null,
        related_contact: c.related_contact || null,
      })
    }
  }
}

async function extractDecisionsFromSession(sessionId: string, convId: string, transcript: string) {
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })
  const { generateEmbedding } = await import('@/lib/embeddings')

  const decisionSchema = {
    type: 'object',
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            decision_text: { type: 'string' },
            context: { type: ['string', 'null'] },
            alternatives_considered: { type: ['string', 'null'] },
          },
          required: ['decision_text', 'context', 'alternatives_considered'],
          additionalProperties: false,
        },
      },
    },
    required: ['decisions'],
    additionalProperties: false,
  }

  const response = await anthropicClient.messages.create({
    model: 'google/gemini-3.1-flash-lite-preview',
    max_tokens: 600,
    system: `Extract decisions that JASON (the user) made during this conversation. Decisions are choices, directions, policies, or strategic calls - not tasks or commitments.

Examples of decisions:
- "Let's go with vendor X for the POS upgrade"
- "We're not renewing the lease at 1008"
- "I want to hold off on hiring until Q3"
- "We'll run the promo only on weekdays"

Do NOT extract:
- Tasks or action items (those are tracked separately)
- Commitments to do something (also tracked separately)
- Things Crosby suggested that Jason didn't explicitly agree to
- Vague preferences or off-hand comments

For each decision, include:
- decision_text: The decision itself, stated clearly
- context: Why Jason made this decision (if discussed)
- alternatives_considered: Other options that were discussed but not chosen (if any)

Return JSON: {"decisions": [{"decision_text": "...", "context": "...", "alternatives_considered": "..."}]}
Return {"decisions": []} if none found.`,
    messages: [{ role: 'user', content: transcript.slice(0, 6000) }],
    ...({
      extra_body: {
        models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'],
        provider: { sort: 'price' },
        plugins: [{ id: 'response-healing' }],
        response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: decisionSchema } },
      },
    } as any),
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = parseJSON(text)
  }
  if (!parsed.decisions || parsed.decisions.length === 0) return

  for (const d of parsed.decisions) {
    if (!d.decision_text) continue

    // Insert decision
    const { data: inserted } = await supabaseAdmin.from('decisions').insert({
      session_id: sessionId,
      conversation_id: convId,
      decision_text: d.decision_text,
      context: d.context || null,
      alternatives_considered: d.alternatives_considered || null,
    }).select('id').single()

    // Generate and store embedding (fire-and-forget)
    if (inserted) {
      generateEmbedding(`${d.decision_text}${d.context ? ` — ${d.context}` : ''}`)
        .then(embedding => supabaseAdmin.from('decisions').update({ embedding }).eq('id', inserted.id))
        .catch(e => console.error('Decision embedding failed:', e))
    }
  }
}

async function extractWatchesFromSession(convId: string, transcript: string) {
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

  const watchSchema = {
    type: 'object',
    properties: {
      watches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            watch_type: { type: 'string', enum: ['email_reply', 'keyword', 'sender', 'topic'] },
            description: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' } },
            sender_email: { type: ['string', 'null'] },
            sender_domain: { type: ['string', 'null'] },
            priority: { type: 'string', enum: ['high', 'normal'] },
            semantic_context: { type: 'string' },
          },
          required: ['watch_type', 'description', 'keywords', 'sender_email', 'sender_domain', 'priority', 'semantic_context'],
          additionalProperties: false,
        },
      },
    },
    required: ['watches'],
    additionalProperties: false,
  }

  const response = await anthropicClient.messages.create({
    model: 'google/gemini-3.1-flash-lite-preview',
    max_tokens: 600,
    system: `Review this conversation and identify things Jason is waiting for, tracking, or monitoring. Look for:
- Outreach he made ("I reached out to...", "I emailed...", "I sent that to...")
- Things he's waiting on ("waiting to hear back", "let's see if they respond", "should hear back soon")
- Pending items from others ("they said they'd send it", "she's supposed to get back to me")
- Decisions pending external input ("depends on what the city says", "once we get the numbers")
- Anything where a future event or response matters to Jason

For each, return:
- watch_type: "email_reply" if waiting for an email response, "sender" if monitoring a specific person, "keyword" if monitoring a topic, "topic" for general monitoring
- description: what Jason is waiting for, in plain language
- keywords: 3-8 relevant terms (org names, people, topics, locations)
- sender_email: specific email if known, null otherwise
- sender_domain: org domain if known (e.g. "sjearthquakes.com"), null otherwise
- priority: "high" if time-sensitive or important, "normal" otherwise
- semantic_context: rich context about what this is and why it matters, include project/topic it relates to

Return {"watches": []} if nothing found. Don't extract watches for vague or trivial items.`,
    messages: [{ role: 'user', content: transcript.slice(0, 6000) }],
    ...({
      extra_body: {
        models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'],
        provider: { sort: 'price' },
        plugins: [{ id: 'response-healing' }],
        response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: watchSchema } },
      },
    } as any),
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = parseJSON(text)
  }
  if (!parsed.watches || parsed.watches.length === 0) return

  // Load existing active watches for deduplication
  const { data: existingWatches } = await supabaseAdmin
    .from('conversation_watches')
    .select('*')
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())

  // Load active notification rules to avoid overlap
  const { data: notifRules } = await supabaseAdmin
    .from('notification_rules')
    .select('match_type, match_value')
    .eq('is_active', true)

  const activeWatches = existingWatches || []
  const activeRules = notifRules || []

  let createdCount = 0

  for (const w of parsed.watches) {
    if (!w.description || !w.keywords || w.keywords.length === 0) continue

    const newKeywords = (w.keywords as string[]).map((k: string) => k.toLowerCase())

    // Dedup: check if notification_rules already cover this sender/keyword
    const coveredByRule = activeRules.some((rule: any) => {
      if (rule.match_type === 'sender' && w.sender_email && rule.match_value?.toLowerCase() === w.sender_email.toLowerCase()) return true
      if (rule.match_type === 'sender' && w.sender_domain && rule.match_value?.toLowerCase()?.includes(w.sender_domain.toLowerCase())) return true
      if (rule.match_type === 'keyword' && newKeywords.some((k: string) => rule.match_value?.toLowerCase()?.includes(k))) return true
      return false
    })
    if (coveredByRule) continue

    // Dedup: check existing watches for same sender_domain + 2+ overlapping keywords
    const isDuplicate = activeWatches.some((existing: any) => {
      const criteria = existing.match_criteria || {}
      const existingKeywords = (criteria.keywords || []).map((k: string) => k.toLowerCase())

      // Same sender_domain + 2+ keyword overlap
      if (w.sender_domain && criteria.sender_domain &&
          w.sender_domain.toLowerCase() === criteria.sender_domain.toLowerCase()) {
        const overlap = newKeywords.filter((k: string) => existingKeywords.includes(k)).length
        if (overlap >= 2) return true
      }

      // 50%+ keyword overlap (proxy for similar semantic_context)
      if (existingKeywords.length > 0 && newKeywords.length > 0) {
        const overlap = newKeywords.filter((k: string) => existingKeywords.includes(k)).length
        const overlapRatio = overlap / Math.min(newKeywords.length, existingKeywords.length)
        if (overlapRatio >= 0.5) return true
      }

      return false
    })
    if (isDuplicate) continue

    // Create the watch
    await supabaseAdmin.from('conversation_watches').insert({
      conversation_id: convId,
      watch_type: w.watch_type,
      match_criteria: {
        thread_id: null,
        sender_email: w.sender_email || null,
        sender_domain: w.sender_domain || null,
        keywords: w.keywords,
        semantic_context: w.semantic_context,
      },
      context: w.description,
      priority: w.priority || 'normal',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    createdCount++
  }

  // Store new watch descriptions on the session for greeting injection
  if (createdCount > 0) {
    const watchDescriptions = parsed.watches
      .slice(0, createdCount)
      .map((w: any) => w.description)
      .filter(Boolean)

    // Store in user_state so the session greeting can pick it up
    const { data: existing } = await supabaseAdmin
      .from('user_state')
      .select('value')
      .eq('key', 'recent_auto_watches')
      .single()

    const existingWatchList = existing?.value?.watches || []
    await supabaseAdmin
      .from('user_state')
      .upsert({
        key: 'recent_auto_watches',
        value: {
          watches: [...watchDescriptions, ...existingWatchList].slice(0, 10),
          updated_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })

    console.log(`[watch-extraction] Created ${createdCount} watches from session in conversation ${convId}`)
  }
}

async function executeNotepadTool(
  input: { operation: string; content?: string; title?: string; note_id?: string },
): Promise<{ status: string; note?: Note; notes?: Note[]; message?: string }> {
  switch (input.operation) {
    case 'create': {
      if (!input.content) return { status: 'error', message: 'content is required' }
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

async function executeContactsTool(
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

function parseJSON(text: string) {
  let cleaned = text.trim()
  // Strip markdown code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  // Try to extract JSON object if there's surrounding text
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    return JSON.parse(match[0])
  }
  return JSON.parse(cleaned)
}

// Background: Extract memories
async function extractMemories(conversationId: string, userMessage: string, assistantResponse: string) {
  try {
    // Load existing memories so Claude can avoid duplicates
    const { data: existingMemories } = await supabaseAdmin
      .from('memories')
      .select('id, content, category')
      .order('created_at', { ascending: false })
      .limit(50)

    const existingList = (existingMemories || [])
      .map((m: any) => `- [${m.category}] (id: ${m.id}) ${m.content}`)
      .join('\n')

    const memorySchema = {
      type: 'object',
      properties: {
        create: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              category: { type: 'string', enum: ['fact', 'preference', 'context'] },
            },
            required: ['content', 'category'],
            additionalProperties: false,
          },
        },
        update: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              category: { type: 'string', enum: ['fact', 'preference', 'context'] },
            },
            required: ['id', 'content', 'category'],
            additionalProperties: false,
          },
        },
      },
      required: ['create', 'update'],
      additionalProperties: false,
    }

    const response = await openrouterClient.chat.completions.create({
      model: 'google/gemini-3.1-flash-lite-preview',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: `You manage a memory system for Jason DeMayo (also goes by "Jerry"). Extract genuinely NEW information from this conversation turn.

Rules:
- Each memory: ONE concise sentence, max two. No paragraphs.
- Skip anything already covered by existing memories below.
- Skip generic/obvious info. Only store specifics about Jason's business, preferences, contacts, or ongoing situations.
- If new info updates an existing memory, use "update" with that memory's id.
- If completely new, use "create".
- If nothing new worth storing, return empty arrays.
- Jason = Jerry = Jason DeMayo. Never store this alias as a separate memory.

PREFERENCE DETECTION — pay special attention to statements about alerts, notifications, briefings, and what Jason cares about. These should be stored with category "preference". Examples:
- "Stop alerting me about X" → preference: "Do not alert about X"
- "Always tell me when Y" → preference: "Always alert when Y happens"
- "I don't care about Z" → preference: "Exclude Z from briefings and alerts"
- "Morning briefings should focus on..." → preference about briefing content
- "Only alert for high-priority items" → preference about alert threshold
- "Include/exclude [store/topic] in briefings" → preference about briefing scope
Any time Jason expresses what he wants to see more or less of, that's a preference.

EXISTING MEMORIES:
${existingList || '(none)'}

Return raw JSON only:
{"create": [{"content": "...", "category": "fact|preference|context"}], "update": [{"id": "uuid", "content": "updated text", "category": "fact|preference|context"}]}` },
        { role: 'user', content: `User said: ${userMessage}\n\nAssistant replied: ${assistantResponse}` },
      ],
      ...({
        models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'],
        provider: { sort: 'price' },
        plugins: [{ id: 'response-healing' }],
        response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: memorySchema } },
      } as any),
    } as any)

    const text = response.choices[0]?.message?.content || ''
    console.log('Memory extraction raw:', text.slice(0, 200))
    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = parseJSON(text)
    }

    // Handle creates
    if (parsed.create && parsed.create.length > 0) {
      for (const memory of parsed.create) {
        if (memory.content && memory.content.length > 5) {
          await supabaseAdmin.from('memories').insert({
            content: memory.content,
            category: memory.category || 'context',
            source_conversation_id: conversationId,
          })
        }
      }
      console.log(`Memory: created ${parsed.create.length} new`)
    }

    // Handle updates
    if (parsed.update && parsed.update.length > 0) {
      for (const memory of parsed.update) {
        if (memory.id && memory.content) {
          await supabaseAdmin.from('memories').update({
            content: memory.content,
            category: memory.category || 'context',
            updated_at: new Date().toISOString(),
          }).eq('id', memory.id)
        }
      }
      console.log(`Memory: updated ${parsed.update.length} existing`)
    }

    if ((!parsed.create || parsed.create.length === 0) && (!parsed.update || parsed.update.length === 0)) {
      console.log('Memory: nothing new to store')
    }
  } catch (e) {
    console.error('Memory extraction failed:', e)
  }
}

// --- Phase 3: SOP Detection ---
const SOP_DETECTION_SCHEMA = {
  type: 'object',
  properties: {
    process_detected: { type: 'boolean' },
    process_name: { type: 'string' },
    step_count: { type: 'number' },
  },
  required: ['process_detected', 'process_name', 'step_count'],
  additionalProperties: false,
}

async function detectAndTrackProcesses(convId: string, transcript: string, summary: string) {
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })

  // Detect if a process was explained step-by-step
  const response = await anthropicClient.messages.create({
    model: 'google/gemini-3.1-flash-lite-preview',
    max_tokens: 200,
    system: `Detect if Jason DeMayo explained a business process, procedure, or workflow step-by-step during this conversation. Examples: how they handle vendor invoices, how they open a new store, how they onboard GMs, how they handle a health inspection. NOT generic discussions - only when he clearly described steps/stages.

Return JSON: {"process_detected": true/false, "process_name": "Name of the process (e.g. 'New Store Opening Checklist')", "step_count": <estimated number of steps described>}
If no process detected: {"process_detected": false, "process_name": "", "step_count": 0}`,
    messages: [{ role: 'user', content: `Summary:\n${summary}\n\nKey transcript excerpts:\n${transcript.slice(0, 3000)}` }],
    ...({
      extra_body: {
        models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3-flash-preview'],
        provider: { sort: 'price' },
        plugins: [{ id: 'response-healing' }],
        response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: SOP_DETECTION_SCHEMA } },
      },
    } as any),
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    return
  }

  if (!parsed.process_detected || !parsed.process_name) return

  // Check if we already have this process in the DB
  const { data: existingProcesses } = await supabaseAdmin
    .from('detected_processes')
    .select('id, times_explained, conversation_ids, sop_drafted, step_count')
    .ilike('process_name', `%${parsed.process_name.slice(0, 30)}%`)
    .limit(1)

  if (existingProcesses && existingProcesses.length > 0) {
    const existing = existingProcesses[0]

    // Update: increment count and add conversation
    const updatedConvIds = [...(existing.conversation_ids || []), convId]
    const newCount = existing.times_explained + 1

    await supabaseAdmin
      .from('detected_processes')
      .update({
        times_explained: newCount,
        conversation_ids: updatedConvIds,
        last_explained_at: new Date().toISOString(),
        step_count: Math.max(existing.step_count || 0, parsed.step_count),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    // If explained 2+ times and SOP not yet drafted, spawn a job
    if (newCount >= 2 && !existing.sop_drafted) {
      const mainConvId = await getMainConversation()
      const sopPrompt = `Draft a Standard Operating Procedure (SOP) document for the following business process: "${parsed.process_name}"

This process has been explained ${newCount} times in conversations. Pull together everything you know about it from conversation history, project context, and documents.

The SOP should include:
1. Purpose and scope
2. Step-by-step procedure (numbered)
3. Who is responsible for each step
4. Any tools, systems, or resources needed
5. Common pitfalls or notes

After creating the content, save it as a freeform artifact named "SOP: ${parsed.process_name}".

Then write a brief message to Jason saying something like: "I noticed you've explained the ${parsed.process_name} process a few times across different conversations. I drafted an SOP based on those discussions - take a look and let me know if it needs adjustments."`

      const job = await spawnBackgroundJob(mainConvId, 'sop', sopPrompt, 'sop_detection', {
        process_name: parsed.process_name,
        times_explained: newCount,
        detected_process_id: existing.id,
      })

      // Mark as SOP drafted
      await supabaseAdmin
        .from('detected_processes')
        .update({ sop_drafted: true, updated_at: new Date().toISOString() })
        .eq('id', existing.id)

      console.log(`SOP detection: spawned SOP draft job ${job.id} for "${parsed.process_name}"`)
    }
  } else {
    // First time seeing this process - insert it
    await supabaseAdmin.from('detected_processes').insert({
      process_name: parsed.process_name,
      conversation_ids: [convId],
      step_count: parsed.step_count,
      times_explained: 1,
      last_explained_at: new Date().toISOString(),
    })

    console.log(`SOP detection: first instance of process "${parsed.process_name}" recorded`)
  }
}

// --- Watch management tool handlers ---

async function executeCreateWatch(input: {
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

async function executeListWatches(): Promise<{ status: string; watches?: any[]; message?: string }> {
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

async function executeCancelWatch(input: { watch_id: string }): Promise<{ status: string; message?: string }> {
  if (!input.watch_id) return { status: 'error', message: 'watch_id is required' }

  const { error } = await supabaseAdmin
    .from('conversation_watches')
    .update({ status: 'expired' })
    .eq('id', input.watch_id)

  if (error) return { status: 'error', message: error.message }
  return { status: 'cancelled', message: 'Watch cancelled' }
}
