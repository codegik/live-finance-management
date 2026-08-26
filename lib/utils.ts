import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** The shadcn class merge: clsx for conditionals, tailwind-merge to let a later
 *  utility win over an earlier conflicting one (e.g. a caller's `px-6` over a
 *  component default `px-4`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Categories alphabetically by name, for a select the household scans to pick
 * one. Not applied at listCategories: the budget editor, month/year and the
 * category-management screen order the same list by sortOrder on purpose, so
 * only the pickers sort here. Locale-aware so "Água" and "Alimentação" fall
 * where a reader looks, not after "Z". Returns a new array, leaving the shared
 * input untouched.
 */
export function sortByName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}
