import type { SpecialistDefinition } from '../types'

/**
 * Full tasks specialist — router-gated. Only activates when the message
 * is about tasks/action items. Loads all 30 pending/approved items.
 */
export const tasksSpecialist: SpecialistDefinition = {
  id: 'tasks',
  name: 'Tasks',
  description: 'Handles action items and delegation',
  tools: ['manage_action_items'],
  dataNeeded: ['action_items'],
  triggerRules: {
    trigger_tools: ['manage_action_items'],
    trigger_data: ['action_items'],
  },
  source: 'built_in',
  systemPromptSection: `{{action_items_section}}`,
}

/**
 * Critical tasks specialist — always on. Loads only high-priority,
 * overdue, and due-soon items (tiny set) plus a total count summary.
 * When the full tasks specialist is also active, this renders empty
 * to avoid duplication.
 */
export const tasksCriticalSpecialist: SpecialistDefinition = {
  id: 'tasks_critical',
  name: 'Tasks (Critical)',
  description: 'Always-on critical action items summary',
  tools: ['manage_action_items'],
  dataNeeded: ['action_items_critical'],
  triggerRules: { always_on: true },
  source: 'built_in',
  systemPromptSection: `{{action_items_critical_section}}`,
}
