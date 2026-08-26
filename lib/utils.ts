import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** The shadcn class merge: clsx for conditionals, tailwind-merge to let a later
 *  utility win over an earlier conflicting one (e.g. a caller's `px-6` over a
 *  component default `px-4`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
