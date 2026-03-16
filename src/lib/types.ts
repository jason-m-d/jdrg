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
  created_at: string
  updated_at: string
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
