/**
 * next/navigation's redirect() (and next-auth's signIn with `redirectTo`)
 * signals by THROWING a digest-tagged error. Any catch that turns failures
 * into a form error must let that one through, or a successful sign-in would
 * render as an error message and the user would never leave the page.
 */
export function isNextRedirectError(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null | undefined)?.digest
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')
}
