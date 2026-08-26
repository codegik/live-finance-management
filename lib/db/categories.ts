import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  type CategoryGroup,
  SEED_CATEGORIES,
  SYSTEM_CATEGORY_SEED_KEYS,
} from '@/lib/domain/seed-categories'
import type { Executor } from './client'
import { categories, type Category } from './schema'

/**
 * Thrown when an edit or archive targets a SYSTEM category
 * (SYSTEM_CATEGORY_SEED_KEYS). Named so the settings action can turn it into a
 * message the household can read rather than letting it surface as a 500.
 */
export class SystemCategoryError extends Error {
  constructor() {
    super('SYSTEM_CATEGORY')
    this.name = 'SystemCategoryError'
  }
}

/**
 * Whether this category is one the app addresses by seedKey. Reads the row so
 * the check is on the stored identity, not on anything the caller passed.
 */
async function isSystemCategory(
  exec: Executor,
  householdId: string,
  categoryId: string,
): Promise<boolean> {
  const [row] = await exec
    .select({ seedKey: categories.seedKey })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
    .limit(1)
  return row?.seedKey != null && SYSTEM_CATEGORY_SEED_KEYS.has(row.seedKey)
}

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
        group: category.group,
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
  group: CategoryGroup = 'DESPESA_VARIAVEL',
): Promise<Category> {
  const [row] = await exec
    .insert(categories)
    .values({ householdId, name: name.trim(), group, sortOrder: 1_000 })
    .returning()
  return row
}

/**
 * A category's editable fields, written together.
 *
 * One function and one UPDATE rather than a rename and a move, because the
 * screen edits them on one row with one button: two writes would let a saved
 * name land while a rejected block did not, and leave the row showing a state
 * that was never stored.
 *
 * Changing `group` is not cosmetic. GROUP_BUDGET_ROLE means moving a category
 * into or out of RECEITA changes which transactions its actuals are read
 * from, so a category carrying spend that is moved to Receita reads zero
 * until income rows point at it -- correct, but worth knowing before the
 * number is disbelieved.
 */
export async function updateCategory(
  exec: Executor,
  householdId: string,
  categoryId: string,
  fields: { name: string; group: CategoryGroup },
): Promise<void> {
  // A SYSTEM category's name and group are addressed by the classification
  // code; renaming or moving it would break that code silently.
  if (await isSystemCategory(exec, householdId, categoryId)) throw new SystemCategoryError()

  await exec
    .update(categories)
    .set({ name: fields.name.trim(), group: fields.group })
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
}

export async function archiveCategory(
  exec: Executor,
  householdId: string,
  categoryId: string,
): Promise<void> {
  // Archiving a SYSTEM category would take it out of the picker the household
  // needs to file transfers under, and seedCategories would not bring it back:
  // its onConflictDoNothing sees the seedKey still present and leaves the row
  // archived. Not allowed.
  if (await isSystemCategory(exec, householdId, categoryId)) throw new SystemCategoryError()

  await exec
    .update(categories)
    .set({ archivedAt: new Date() })
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
}

/**
 * A category id is only usable by the household that owns it. Archived
 * categories still count as belonging -- a MANUAL assignment to an archived
 * category is legitimate, only the picker hides it.
 */
export async function categoryBelongsToHousehold(
  exec: Executor,
  householdId: string,
  categoryId: string,
): Promise<boolean> {
  const rows = await exec
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
    .limit(1)
  return rows.length > 0
}
