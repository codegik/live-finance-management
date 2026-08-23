'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { createRule, deleteRule } from '@/lib/db/rules'
import {
  CHOOSE_RULE_ERROR,
  DUPLICATE_RULE_ERROR,
  EMPTY_RULE_ERROR,
  SAVED_MESSAGE,
  type SettingsState,
  UNKNOWN_CATEGORY_ERROR,
} from '../categories/state'

function revalidate(): void {
  revalidatePath('/settings/rules')
  revalidatePath('/inbox')
  revalidatePath('/ledger')
}

export async function createRuleAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await requireSession()
  const pattern = String(formData.get('pattern') ?? '').trim()
  const categoryId = String(formData.get('categoryId') ?? '')
  const matchType = formData.get('matchType') === 'CONTAINS' ? 'CONTAINS' : 'EXACT'
  if (!pattern || !categoryId) return { error: EMPTY_RULE_ERROR, message: null }

  let changed = 0
  try {
    ;({ changed } = await createRule(getDb(), session.householdId, {
      matchType,
      pattern,
      categoryId,
    }))
  } catch (error) {
    // A pattern that normalizes to nothing, one that duplicates an existing
    // rule, or a category id that does not belong to this household are all
    // ordinary user error rather than a server fault.
    if (error instanceof Error && error.message === 'EMPTY_PATTERN') {
      return { error: EMPTY_RULE_ERROR, message: null }
    }
    if (error instanceof Error && error.message === 'UNKNOWN_CATEGORY') {
      return { error: UNKNOWN_CATEGORY_ERROR, message: null }
    }
    // postgres.js surfaces a unique-violation as a PostgresError with a
    // Postgres error code, not a distinguishable message -- narrow on the
    // code, not on message text, which is not guaranteed stable.
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
      return { error: DUPLICATE_RULE_ERROR, message: null }
    }
    throw error
  }

  revalidate()
  return { error: null, message: `${SAVED_MESSAGE} ${changed} transactions recategorized.` }
}

export async function deleteRuleAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await requireSession()
  const ruleId = String(formData.get('ruleId') ?? '')
  if (!ruleId) return { error: CHOOSE_RULE_ERROR, message: null }

  // deleteRule recategorizes what the rule used to match, so removing a bad
  // rule undoes it rather than leaving stale assignments behind.
  const { changed } = await deleteRule(getDb(), session.householdId, ruleId)

  revalidate()
  return { error: null, message: `${SAVED_MESSAGE} ${changed} transactions returned to the inbox.` }
}
