/**
 * LIKE metacharacters in a string the household typed must not act as
 * wildcards.
 *
 * Two callers depend on this and would each be wrong without it in a
 * different way. A merchant rule reading `50% OFF` would, unescaped, match
 * every merchant in the household and quietly recategorize the lot. The
 * ledger's search box is worse still, because it is typed into casually: a
 * lone `%` would return the entire statement while looking like a filter,
 * and `_` would match any single character, so searching for a descriptor
 * copied off a bill would silently pull in rows that do not contain it.
 *
 * Backslash is Postgres's default LIKE escape character, so escaping it,
 * `%` and `_` is the whole job -- and the backslash itself must be escaped
 * first-class, or `\%` typed by a person would arrive as an escape sequence
 * rather than the two characters they typed.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}
