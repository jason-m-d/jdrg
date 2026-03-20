import type { SpecialistDefinition } from './types'
import type { RouterResult } from '@/lib/router'

import { emailSpecialist } from './built-in/email'
import { calendarSpecialist } from './built-in/calendar'
import { salesSpecialist } from './built-in/sales'
import { tasksSpecialist, tasksCriticalSpecialist } from './built-in/tasks'
import { documentsSpecialist } from './built-in/documents'
import { textsSpecialist } from './built-in/texts'
import { coreSpecialist } from './built-in/core'

const specialistRegistry = new Map<string, SpecialistDefinition>()

export function registerSpecialist(def: SpecialistDefinition): void {
  specialistRegistry.set(def.id, def)
}

export function getSpecialist(id: string): SpecialistDefinition | undefined {
  return specialistRegistry.get(id)
}

/**
 * Evaluate each registered specialist's triggerRules against the router result
 * and return the ones that should be active for this message.
 *
 * The evaluation is generic - it does not care whether the specialist came from
 * a code file or a DB row. This allows user-created specialists (future) to use
 * the same resolution path as built-in ones.
 */
export function resolveSpecialists(routerResult: RouterResult): SpecialistDefinition[] {
  const active: SpecialistDefinition[] = []

  for (const specialist of specialistRegistry.values()) {
    const rules = specialist.triggerRules

    if (rules.always_on) {
      active.push(specialist)
      continue
    }

    if (rules.trigger_tools?.some(tool => routerResult.tools_needed.includes(tool))) {
      active.push(specialist)
      continue
    }

    if (rules.trigger_data?.some(data => routerResult.data_needed.includes(data))) {
      active.push(specialist)
      continue
    }
  }

  return active
}

/**
 * Load user-created specialists from the database.
 * TODO: Query the `specialists` table in Supabase and return user-created
 * SpecialistDefinition objects. For now, returns an empty array.
 */
export async function loadUserSpecialists(): Promise<SpecialistDefinition[]> {
  // TODO: fetch from specialists table when the DB table is created
  return []
}

// Register all built-in specialists on module init
;[
  coreSpecialist,
  tasksSpecialist,
  tasksCriticalSpecialist,
  emailSpecialist,
  calendarSpecialist,
  salesSpecialist,
  documentsSpecialist,
  textsSpecialist,
].forEach(registerSpecialist)

// Register user-created specialists (no-op until DB table exists)
loadUserSpecialists().then(userSpecialists => {
  userSpecialists.forEach(registerSpecialist)
}).catch(err => {
  console.warn('[SpecialistRegistry] Failed to load user specialists:', err)
})

export { specialistRegistry }
