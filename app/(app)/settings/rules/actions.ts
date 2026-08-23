'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { createRule, deleteRule } from '@/lib/db/rules'
import { EMPTY_RULE_ERROR, SAVED_MESSAGE, type SettingsState } from '../categories/state'

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
    // A pattern that normalizes to nothing, or one that duplicates an
    // existing rule, is ordinary user error rather than a server fault.
    if (error instanceof Error && error.message === 'EMPTY_PATTERN') {
      return { error: EMPTY_RULE_ERROR, message: null }
    }
    throw error
  }

  revalidatePath('/settings/rules')
  revalidatePath('/inbox')
  revalidatePath('/ledger')
  return { error: null, message: `${SAVED_MESSAGE} ${changed} transactions recategorized.` }
}

export async function deleteRuleAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await requireSession()
  const ruleId = String(formData.get('ruleId') ?? '')
  if (!ruleId) return { error: 'Choose a rule to delete.', message: null }

  // deleteRule recategorizes what the rule used to match, so removing a bad
  // rule undoes it rather than leaving stale assignments behind.
  const { changed } = await deleteRule(getDb(), session.householdId, ruleId)

  revalidatePath('/settings/rules')
  revalidatePath('/inbox')
  revalidatePath('/ledger')
  return { error: null, message: `${SAVED_MESSAGE} ${changed} transactions returned to the inbox.` }
}
