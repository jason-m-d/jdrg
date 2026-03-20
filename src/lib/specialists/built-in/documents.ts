import type { SpecialistDefinition } from '../types'

export const documentsSpecialist: SpecialistDefinition = {
  id: 'documents',
  name: 'Documents',
  description: 'Handles RAG retrieval from uploaded files and document context',
  tools: [],
  dataNeeded: ['documents_rag', 'context_chunks'],
  triggerRules: {
    trigger_data: ['documents_rag', 'context_chunks'],
  },
  source: 'built_in',
  systemPromptSection: `{{document_context_section}}`,
}
