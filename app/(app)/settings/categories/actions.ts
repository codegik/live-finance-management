'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { archiveCategory, createCategory, renameCategory } from '@/lib/db/categories'
import { getDb } from '@/lib/db/client'
import { EMPTY_NAME_ERROR, SAVED_MESSAGE, type SettingsState } from './state'

function revalidate(): void {
  revalidatePath('/settings/categories')
  revalidatePath('/inbox')
  revalidatePath('/ledger')
}

export async function createCategoryAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await requireSession()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: EMPTY_NAME_ERROR, message: null }

  await createCategory(getDb(), session.householdId, name)
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
