import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { connectTokenErrorMessage } from '@/lib/pluggy/connect-errors'

/**
 * Clicking "Connect a bank" against an unfinished .env.local raised a
 * Next.js error overlay reading
 *
 *   Runtime SyntaxError
 *   JSON.parse: unexpected end of data at line 1 column 1 of the JSON data
 *
 * because the button ran `await response.json()` on a failed request without
 * looking at it, and the failed request was a 500 with a ZERO-LENGTH body.
 * Nothing in the message named Pluggy, the route, or the missing variables.
 *
 * The half that can be tested without a browser is here: every response shape
 * the button can meet -- empty body included -- has to produce a sentence.
 * The half that cannot is checked at the source level at the bottom, the same
 * way tests/settings-forms.test.ts checks form wiring: this suite has no DOM
 * to render a component in, and the defect lived in the wiring, not in a
 * function it could call.
 */

it('turns an empty body into a sentence rather than throwing', () => {
  // The exact case that crashed: Next's zero-length 500.
  const message = connectTokenErrorMessage(500, null)

  expect(message).toContain('500')
  expect(message).not.toBe('')
})

it('names the variables to set when the configuration is incomplete', () => {
  const message = connectTokenErrorMessage(503, {
    error: 'ENV_INCOMPLETE',
    detail: 'PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET',
  })

  expect(message).toContain('PLUGGY_CLIENT_ID')
  expect(message).toContain('PLUGGY_CLIENT_SECRET')
  expect(message).toContain('.env.local')
})

it('still names the Pluggy variables when the route sent no detail', () => {
  const message = connectTokenErrorMessage(503, { error: 'ENV_INCOMPLETE' })

  expect(message).toContain('PLUGGY_CLIENT_ID')
  expect(message).toContain('.env.local')
})

it('says the credentials were refused when Pluggy rejects them', () => {
  const message = connectTokenErrorMessage(503, { error: 'PLUGGY_AUTH_FAILED' })

  expect(message).toContain('PLUGGY_CLIENT_ID')
  expect(message).toContain('PLUGGY_SETUP.md')
})

it('falls back to the status for a code this build does not know', () => {
  // A newer server, or a proxy answering in its own vocabulary. The status is
  // the only thing left to report, and reporting it beats "it didn't work".
  expect(connectTokenErrorMessage(502, { error: 'SOMETHING_NEW' })).toContain('502')
  expect(connectTokenErrorMessage(504, 'a proxy timeout page, not JSON')).toContain('504')
})

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const button = readFileSync(join(root, 'components/ConnectBankButton.tsx'), 'utf8')

/**
 * Comments stripped, because the checks below look for code. The comments in
 * that file quote the very calls being banned, in order to explain why -- and
 * a rule that forbids naming the defect would be a rule against documenting
 * it.
 */
const buttonCode = button.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*/g, '')

it('never parses a fetch response as JSON without guarding it', () => {
  // `response.json()` rejects on an empty or non-JSON body, and inside an
  // onClick handler that rejection is an unhandled promise: the overlay. The
  // guarded helper reads the text first, so its absence is the regression.
  expect(buttonCode).not.toMatch(/\.json\(\)/)
  expect(buttonCode).toContain('readJsonBody')
})

it('renders the failure instead of throwing it', () => {
  // A `throw` here reaches nothing that can catch it for the user.
  expect(buttonCode).not.toMatch(/\bthrow new Error\b/)
  expect(buttonCode).toContain('setError')
  expect(buttonCode).toContain('role="alert"')
})
