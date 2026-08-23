import { and, asc, eq } from 'drizzle-orm'
import { monthBounds } from '@/lib/domain/budget'
import { categoryBelongsToHousehold } from './categories'
import type { Executor } from './client'
import { budgets } from './schema'

export type StoredBudget = {
  categoryId: string
  /** Always a first-of-month `YYYY-MM-DD`. */
  periodMonth: string
  amountCents: number
}

/**
 * Every budget row the household has ever set. Carry-forward is resolved at
 * read time from the full history, so this deliberately does not filter by
 * period -- a budget set in August is what answers a question about October.
 */
export async function listBudgets(
  exec: Executor,
  householdId: string,
): Promise<StoredBudget[]> {
  const rows = await exec
    .select({
      categoryId: budgets.categoryId,
      periodMonth: budgets.periodMonth,
      amountCents: budgets.amountCents,
    })
    .from(budgets)
    .where(eq(budgets.householdId, householdId))
    .orderBy(asc(budgets.periodMonth), asc(budgets.categoryId))

  return rows
}

export type SetBudgetInput = {
  categoryId: string
  /** `YYYY-MM`. */
  period: string
  amountCents: number
}

export async function setBudget(
  exec: Executor,
  householdId: string,
  input: SetBudgetInput,
): Promise<void> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new Error(`INVALID_AMOUNT:${String(input.amountCents)}`)
  }
  // A category id arrives from a form, so it is not trusted: without this a
  // household could budget against another household's category.
  if (!(await categoryBelongsToHousehold(exec, householdId, input.categoryId))) {
    throw new Error('UNKNOWN_CATEGORY')
  }

  const { start } = monthBounds(input.period)

  await exec
    .insert(budgets)
    .values({
      householdId,
      categoryId: input.categoryId,
      periodMonth: start,
      amountCents: input.amountCents,
    })
    .onConflictDoUpdate({
      target: [budgets.householdId, budgets.categoryId, budgets.periodMonth],
      set: { amountCents: input.amountCents, updatedAt: new Date() },
    })
}

export async function clearBudget(
  exec: Executor,
  householdId: string,
  input: { categoryId: string; period: string },
): Promise<void> {
  const { start } = monthBounds(input.period)

  await exec
    .delete(budgets)
    .where(
      and(
        eq(budgets.householdId, householdId),
        eq(budgets.categoryId, input.categoryId),
        eq(budgets.periodMonth, start),
      ),
    )
}
