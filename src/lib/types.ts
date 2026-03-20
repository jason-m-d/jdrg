export interface Project {
  id: string
  name: string
  description: string | null
  system_prompt: string | null
  color: string | null
  created_at: string
  updated_at: string
}

export interface Document {
  id: string
  title: string
  content: string | null
  file_url: string | null
  file_type: 'pdf' | 'docx' | 'xlsx' | 'text' | 'created' | null
  project_id: string | null
  is_living: boolean
  is_pinned: boolean
  is_template: boolean
  version: number
  created_at: string
  updated_at: string
}

export interface DocumentVersion {
  id: string
  document_id: string
  content: string | null
  version: number
  change_summary: string | null
  created_at: string
}

export interface DocumentChunk {
  id: string
  document_id: string
  chunk_index: number
  content: string | null
  embedding: number[] | null
  created_at: string
}

export interface Conversation {
  id: string
  title: string | null
  project_id: string | null
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  sources: Record<string, unknown>[] | null
  message_type?: 'briefing' | 'nudge' | 'alert' | 'watch_match' | 'email_heads_up' | 'bridge_status' | null
  created_at: string
}

export interface Memory {
  id: string
  content: string
  category: string | null
  source_conversation_id: string | null
  created_at: string
  updated_at: string
}

export interface ActionItem {
  id: string
  title: string
  description: string | null
  source: 'chat' | 'email' | null
  source_id: string | null
  source_snippet: string | null
  status: 'pending' | 'approved' | 'dismissed' | 'completed'
  priority: 'high' | 'medium' | 'low'
  due_date: string | null
  confidence: number | null
  dismissal_reason: string | null
  snoozed_until: string | null
  last_surfaced_at: string | null
  last_nudged_at: string | null
  created_at: string
  updated_at: string
}

export interface Decision {
  id: string
  session_id: string | null
  conversation_id: string | null
  project_id: string | null
  decision_text: string
  context: string | null
  alternatives_considered: string | null
  decided_at: string
  embedding: number[] | null
}

export interface Commitment {
  id: string
  session_id: string | null
  conversation_id: string | null
  commitment_text: string
  target_date: string | null
  related_contact: string | null
  status: 'open' | 'fulfilled' | 'expired'
  created_at: string
  fulfilled_at: string | null
}

export interface EmailThread {
  id: string
  gmail_thread_id: string
  gmail_account: string
  subject: string | null
  last_sender: string | null
  last_sender_email: string | null
  last_message_date: string | null
  direction: 'inbound' | 'outbound'
  needs_response: boolean
  response_detected: boolean
  created_at: string
  updated_at: string
}

export interface TrainingExample {
  id: string
  snippet: string
  is_action_item: boolean
  label_source: 'teach_me' | 'feedback' | 'implicit'
  action_item_id: string | null
  source_type: 'email' | 'chat' | null
  embedding: number[] | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface TrainingRule {
  id: string
  rule: string
  category: 'always_flag' | 'never_flag' | 'conditional'
  is_active: boolean
  created_at: string
}

export interface EmailScan {
  id: string
  account: string
  last_scanned_at: string | null
  emails_processed: number
  action_items_found: number
}

export interface SalesData {
  id: string
  report_date: string
  brand: 'wingstop' | 'mrpickles' | null
  store_number: string | null
  store_name: string | null
  net_sales: number | null
  forecast_sales: number | null
  budget_sales: number | null
  transaction_count: number | null
  raw_email_id: string | null
  parsed_at: string
}

export interface GmailToken {
  id: string
  account: string
  refresh_token: string
  access_token: string | null
  expires_at: string | null
  created_at: string
}

export interface ProjectContext {
  id: string
  project_id: string
  title: string
  content: string
  source_conversation_id: string | null
  created_at: string
  updated_at: string
}

export interface ContextChunk {
  id: string
  context_id: string
  chunk_index: number
  content: string | null
  embedding: number[] | null
  created_at: string
}

export interface Artifact {
  id: string
  name: string
  content: string
  type: 'plan' | 'spec' | 'checklist' | 'freeform'
  conversation_id: string | null
  project_id: string | null
  version: number
  created_at: string
  updated_at: string
}

export interface ArtifactVersion {
  id: string
  artifact_id: string
  content: string
  version: number
  change_summary: string | null
  changed_by: 'user' | 'assistant'
  created_at: string
}

export interface DashboardCard {
  id: string
  title: string
  content: string
  card_type: 'summary' | 'alert' | 'custom'
  position: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface NotificationRule {
  id: string
  description: string
  match_type: 'sender' | 'subject' | 'keyword'
  match_value: string
  match_field: string
  is_active: boolean
  created_at: string
}

export interface Bookmark {
  id: string
  project_id: string | null
  url: string
  title: string
  description: string | null
  created_at: string
}

export interface UIPreference {
  id: string
  key: string
  value: string
  created_at: string
  updated_at: string
}

export interface Session {
  id: string
  conversation_id: string
  started_at: string
  ended_at: string | null
  summary: string | null
  message_count: number
}

export interface Note {
  id: string
  title: string | null
  content: string
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: string | null
  organization: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ArtifactEvent {
  operation: 'create' | 'update'
  artifact: Artifact
}

export interface AddToProjectEvent {
  status: string
  project_name?: string
  project_id?: string
  context_id?: string
  conversation_url?: string
  message?: string
}

export interface ActionItemEvent {
  action_item: {
    operation: 'create' | 'complete' | 'update' | 'list'
    result: {
      status: string
      item?: ActionItem
      items?: ActionItem[]
      message?: string
    }
  }
}
