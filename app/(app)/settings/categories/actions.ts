'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import {
  archiveCategory,
  createCategory,
  renameCategory,
  setCategoryGroup,
} from '@/lib/db/categories'
import { getDb } from '@/lib/db/client'
import { CATEGORY_GROUPS, type CategoryGroup } from '@/lib/domain/seed-categories'
import {
  EMPTY_NAME_ERROR,
  INVALID_GROUP_ERROR,
  SAVED_MESSAGE,
  type SettingsState,
} from './state'

function revalidate(): void {
  revalidatePath('/settings/categories')
  revalidatePath('/inbox')
  revalidatePath('/ledger')
  // The block a category sits in decides which figures it is totalled under,
  // so a move changes both money screens as well as the settings list.
  revalidatePath('/dashboard')
  revalidatePath('/year')
  revalidatePath('/budgets')
}

/**
 * A select is not a promise. The value arrives as a string from a form the
 * browser is free to have edited, and an unrecognised one would reach Postgres
 * as a bad enum cast -- a 500 rather than a message the household can read.
 */
function parseGroup(raw: string): CategoryGroup | null {
  return (CATEGORY_GROUPS as readonly string[]).includes(raw) ? (raw as CategoryGroup) : null
}

export async function createCategoryAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await requireSession()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: EMPTY_NAME_ERROR, message: null }

  // A new category with no block named lands in variable spending, the same
  // default the column carries -- visible, in the block the household actually
  // reconciles, rather than hidden in one it does not.
  const group = parseGroup(String(formData.get('group') ?? '')) ?? 'DESPESA_VARIAVEL'

  await createCategory(getDb(), session.householdId, name, group)
  revalidate()
  return { error: null, message: SAVED_MESSAGE }
}

/**
 * Moves a category to another block.
 *
 * Separate from renaming on purpose: moving a category into or out of Receita
 * changes which transactions its actuals are read from (GROUP_BUDGET_ROLE), so
 * it is a different act from correcting a spelling and deserves its own
 * button rather than riding along with one.
 */
export async function setCategoryGroupAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await requireSession()
  const categoryId = String(formData.get('categoryId') ?? '')
  if (!categoryId) return { error: EMPTY_NAME_ERROR, message: null }

  const group = parseGroup(String(formData.get('group') ?? ''))
  if (!group) return { error: INVALID_GROUP_ERROR, message: null }

  await setCategoryGroup(getDb(), session.householdId, categoryId, group)
  revalidate()
  return { error: null, message: SAVED_MESSAGE }
}

export async function renameCategoryAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await requireSession()
  const categoryId = String(formData.get('categoryId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!categoryId || !name) return { error: EMPTY_NAME_ERROR, message: null }

  await renameCategory(getDb(), session.householdId, categoryId, name)
  revalidate()
  return { error: null, message: SAVED_MESSAGE }
}

export async function archiveCategoryAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await requireSession()
  const categoryId = String(formData.get('categoryId') ?? '')
  if (!categoryId) return { error: EMPTY_NAME_ERROR, message: null }

  // Archive, never delete: Slice 3 budgets and past spend both point here.
  await archiveCategory(getDb(), session.householdId, categoryId)
  revalidate()
  return { error: null, message: SAVED_MESSAGE }
}
