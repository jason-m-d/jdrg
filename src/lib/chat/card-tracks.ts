import type { ActionItem, CardTrackEvent, SuggestedAction } from '@/lib/types'

/**
 * Groups action items into card track sections for horizontal card display.
 * Returns one CardTrackEvent per non-empty section, ordered by priority.
 */
export function groupActionItemsIntoTracks(items: ActionItem[]): CardTrackEvent[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().split('T')[0]

  const overdue: ActionItem[] = []
  const dueToday: ActionItem[] = []
  const highPriority: ActionItem[] = []
  const noDueDate: ActionItem[] = []

  for (const item of items) {
    const dueDate = item.due_date ? item.due_date.split('T')[0] : null

    if (dueDate && dueDate < todayStr) {
      overdue.push(item)
    } else if (dueDate && dueDate === todayStr) {
      dueToday.push(item)
    } else if (!dueDate && item.priority === 'high') {
      highPriority.push(item)
    } else {
      noDueDate.push(item)
    }
  }

  const sections: { key: string; label: string; priority: number; items: ActionItem[] }[] = [
    { key: 'overdue', label: 'Overdue', priority: 0, items: overdue },
    { key: 'due-today', label: 'Due Today', priority: 1, items: dueToday },
    { key: 'high-priority', label: 'High Priority', priority: 2, items: highPriority },
    { key: 'active', label: 'Active', priority: 3, items: noDueDate },
  ]

  const tracks: CardTrackEvent[] = []

  for (const section of sections) {
    if (section.items.length === 0) continue
    tracks.push({
      track_id: `action-items-${section.key}`,
      track_type: 'action_items',
      section_label: section.label,
      section_priority: section.priority,
      items: section.items.map(item => ({
        id: item.id,
        type: 'action_item' as const,
        data: item,
      })),
    })
  }

  // Attach suggested actions to the last track
  if (tracks.length > 0) {
    const suggestedActions = generateSuggestedActions(items, overdue.length)
    if (suggestedActions.length > 0) {
      tracks[tracks.length - 1].suggested_actions = suggestedActions
    }
  }

  return tracks
}

function generateSuggestedActions(items: ActionItem[], overdueCount: number): SuggestedAction[] {
  const actions: SuggestedAction[] = []

  if (overdueCount > 2) {
    actions.push({
      label: 'Review overdue items',
      action_type: 'send_message',
      message: 'Let\'s go through my overdue items one by one and decide what to do with each.',
    })
  }

  const duplicateTitles = findPotentialDuplicates(items)
  if (duplicateTitles.length > 0) {
    actions.push({
      label: 'Clean up duplicates',
      action_type: 'send_message',
      message: 'I think there are some duplicate action items. Can you identify and merge them?',
    })
  }

  if (items.length > 15) {
    actions.push({
      label: 'What should I focus on?',
      action_type: 'send_message',
      message: 'I have a lot on my plate. What are the top 3 things I should focus on today?',
    })
  }

  return actions
}

function findPotentialDuplicates(items: ActionItem[]): string[] {
  const titleWords = items.map(i => i.title.toLowerCase().split(/\s+/).slice(0, 4).join(' '))
  const seen = new Map<string, number>()
  const dupes: string[] = []

  for (const t of titleWords) {
    const count = (seen.get(t) || 0) + 1
    seen.set(t, count)
    if (count === 2) dupes.push(t)
  }

  return dupes
}

/**
 * Converts card track events to a persistence-friendly format.
 * Includes full item data so hydration on page reload doesn't need a second DB query.
 */
export function cardTracksToMetadata(tracks: CardTrackEvent[]): Record<string, unknown> {
  return {
    card_tracks: tracks.map(t => ({
      track_id: t.track_id,
      track_type: t.track_type,
      section_label: t.section_label,
      section_priority: t.section_priority,
      item_ids: t.items.map(i => i.id),
      items: t.items,
      suggested_actions: t.suggested_actions,
    })),
  }
}
