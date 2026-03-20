import type { SpecialistDefinition } from '../types'

export const artifactsSpecialist: SpecialistDefinition = {
  id: 'artifacts',
  name: 'Artifacts',
  description: 'Handles artifact creation, updates, and project context',
  tools: ['manage_artifact', 'open_artifact', 'manage_project_context'],
  dataNeeded: ['artifacts'],
  triggerRules: {
    trigger_tools: ['manage_artifact', 'open_artifact', 'manage_project_context'],
  },
  source: 'built_in',
  systemPromptSection: `{{artifacts_section}}

{{projects_section}}

{{project_system_prompt_section}}

{{relevant_projects_hint}}`,
}
