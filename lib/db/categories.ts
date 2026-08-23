import { and, asc, eq, isNull } from 'drizzle-orm'
import { SEED_CATEGORIES } from '@/lib/domain/seed-categories'
import type { Executor } from './client'
import { categories, type Category } from './schema'

/**
 * Idempotent: onConflictDoNothing against the (household_id, seed_key)
 * unique index, so re-running it on an existing household is a no-op rather
 * than a duplicate taxonomy.
 */
export async function seedCategories(exec: Executor, householdId: string): Promise<void> {
  await exec
    .insert(categories)
    .values(
      SEED_CATEGORIES.map((category, index) => ({
        householdId,
        name: category.name,
        seedKey: category.seedKey,
        sortOrder: index,
      })),
    )
    .onConflictDoNothing()
}

export async function listCategories(
  exec: Executor,
  householdId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<Category[]> {
  const filters = [eq(categories.householdId, householdId)]
  if (!opts.includeArchived) filters.push(isNull(categories.archivedAt))

  return exec
    .select()
    .from(categories)
    .where(and(...filters))
    .orderBy(asc(categories.sortOrder), asc(categories.name))
}

export async function createCategory(
  exec: Executor,
  householdId: string,
  name: string,
): Promise<Category> {
  const [row] = await exec
    .insert(categories)
    .values({ householdId, name: name.trim(), sortOrder: 1_000 })
    .returning()
  return row
}

export async function renameCategory(
  exec: Executor,
  householdId: string,
  categoryId: string,
  name: string,
): Promise<void> {
  await exec
    .update(categories)
    .set({ name: name.trim() })
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
}

export async function archiveCategory(
  exec: Executor,
  householdId: string,
  categoryId: string,
): Promise<void> {
  await exec
    .update(categories)
    .set({ archivedAt: new Date() })
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
}
