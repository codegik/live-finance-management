'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { listConnectionDetails } from '@/lib/db/connections'
import {
  createRule,
  deleteRule,
  previewRuleMatches,
  type RulePreviewItem,
} from '@/lib/db/rules'
import { type BankOption, bankOptions } from '@/lib/views/bank-options'
import {
  CHOOSE_RULE_ERROR,
  DUPLICATE_RULE_ERROR,
  EMPTY_RULE_ERROR,
  SAVED_MESSAGE,
  type SettingsState,
  UNKNOWN_CATEGORY_ERROR,
  UNKNOWN_CONNECTION_ERROR,
} from '../categories/state'

function revalidate(): void {
  revalidatePath('/settings/rules')
  revalidatePath('/inbox')
  revalidatePath('/ledger')
  // A rule can now be created from the month and year views too, and it moves
  // category totals there the same way it does on the ledger -- so both must
  // re-render or the figure the household is reading would lag its own rule.
  revalidatePath('/dashboard')
  revalidatePath('/year')
}

/**
 * The household's banks, as picker options, fetched on demand when the
 * "create rule from a transaction" panel is opened. Loading them lazily keeps
 * every month- and ledger-row render from carrying a bank list it will almost
 * never use. Scoped to the caller's household by requireSession.
 */
export async function listRuleBankOptionsAction(): Promise<BankOption[]> {
  const session = await requireSession()
  return bankOptions(await listConnectionDetails(getDb(), session.householdId))
}

export async function createRuleAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await requireSession()
  const pattern = String(formData.get('pattern') ?? '').trim()
  const categoryId = String(formData.get('categoryId') ?? '')
  const matchType = formData.get('matchType') === 'CONTAINS' ? 'CONTAINS' : 'EXACT'
  // Optional: an empty selection is "any bank", carried as null.
  const connectionId = String(formData.get('connectionId') ?? '') || null
  if (!pattern || !categoryId) return { error: EMPTY_RULE_ERROR, message: null }

  let changed = 0
  try {
    ;({ changed } = await createRule(getDb(), session.householdId, {
      matchType,
      pattern,
      categoryId,
      connectionId,
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
    if (error instanceof Error && error.message === 'UNKNOWN_CONNECTION') {
      return { error: UNKNOWN_CONNECTION_ERROR, message: null }
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

/**
 * Live preview of the transactions a rule would catch, called as the form is
 * filled in rather than on submit. It is a read scoped to the caller's own
 * household -- a hand-passed connectionId from another household simply matches
 * nothing, because the query filters on the session's household first. An empty
 * pattern short-circuits to no matches, so a cleared box shows nothing rather
 * than every transaction.
 */
export async function previewRuleAction(input: {
  matchType: 'EXACT' | 'CONTAINS'
  pattern: string
  connectionId: string | null
}): Promise<{ total: number; items: RulePreviewItem[] }> {
  const session = await requireSession()
  const pattern = input.pattern.trim()
  if (!pattern) return { total: 0, items: [] }
  const matchType = input.matchType === 'CONTAINS' ? 'CONTAINS' : 'EXACT'
  const connectionId = input.connectionId || null
  return previewRuleMatches(getDb(), session.householdId, { matchType, pattern, connectionId })
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
