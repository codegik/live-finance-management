/**
 * Kept out of actions.ts on purpose: a "use server" module may only export
 * async functions, so the shared state type and messages live here.
 */
export type AssignState = { error: string | null; message: string | null }

export const ASSIGNED_MESSAGE = 'Categorized'
export const MISSING_FIELD_ERROR = 'Choose a category first.'
export const EMPTY_PATTERN_ERROR = 'That pattern has no letters or numbers to match on.'

// Shared with the settings screens: a forged categoryId and a duplicate rule
// map to the same friendly message wherever they are caught. The inbox can
// raise a duplicate just as easily as the rules screen -- it renders one
// independent form per merchant group, and editing two branch groups down to
// the same CONTAINS pattern is the design's headline workflow.
export {
  DUPLICATE_RULE_ERROR,
  UNKNOWN_CATEGORY_ERROR,
} from '@/app/(app)/settings/categories/state'
